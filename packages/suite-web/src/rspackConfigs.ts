// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  type Configuration,
  type DevServer,
  type RspackPluginInstance,
  rspack,
} from "@rspack/core";
import { ReactRefreshRspackPlugin } from "@rspack/plugin-react-refresh";
import path from "path";
import { generateSW } from "workbox-build";

import type { RspackArgv } from "@lichtblick/suite-base/RspackArgv.ts";
import { isOverlayRuntimeError, makeConfig } from "@lichtblick/suite-base/rspack.ts";
import * as palette from "@lichtblick/theme/src/palette.ts";

/**
 * Upper bound for the JS the web app loads before its first render: the entry chunk plus the
 * chunks index.tsx imports while starting (named "startup-*"). The build fails above it, so a
 * shared module that pulls in a panel's heavy dependencies (three.js, monaco, a player) is caught
 * in CI instead of slowing every start. Raise it only for code that is needed to show the app.
 */
const STARTUP_JS_BUDGET_BYTES = 4_300_000;

/** Fails the build when the startup chunks exceed STARTUP_JS_BUDGET_BYTES. */
const startupBudgetPlugin: RspackPluginInstance = {
  apply: (compiler) => {
    compiler.hooks.afterEmit.tap("StartupBudget", (compilation) => {
      const { namedChunkGroups = {} } = compilation.getStats().toJson({
        all: false,
        chunkGroups: true,
        assets: true,
      });
      const files = new Map<string, number>();
      for (const [name, group] of Object.entries(namedChunkGroups)) {
        if (name === "main" || name.startsWith("startup-")) {
          for (const asset of group.assets ?? []) {
            if (asset.name.endsWith(".js")) {
              files.set(asset.name, asset.size ?? 0);
            }
          }
        }
      }
      const total = [...files.values()].reduce((sum, size) => sum + size, 0);
      if (!namedChunkGroups["startup-app"] || !namedChunkGroups["startup-webroot"]) {
        throw new Error("Startup budget: the startup-* chunks are missing, see index.tsx");
      }
      if (total > STARTUP_JS_BUDGET_BYTES) {
        const largest = [...files]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([file, size]) => `${file} ${(size / 1e6).toFixed(2)} MB`);
        throw new Error(
          `Startup JS is ${(total / 1e6).toFixed(2)} MB, over the ${(STARTUP_JS_BUDGET_BYTES / 1e6).toFixed(2)} MB budget. Largest: ${largest.join(", ")}`,
        );
      }
    });
  },
};

/** Cache for hashed build files. Must match the cache name in index.tsx. */
const RUNTIME_CACHE_NAME = "lichtblick-assets";

export type ConfigParams = {
  /** Directory to find `entrypoint` and `tsconfig.json`. */
  contextPath: string;
  entrypoint: string;
  outputPath: string;
  publicPath?: string;
  /** Source map (`devtool`) setting to use for production builds */
  prodSourceMap: Configuration["devtool"];
  /** Set the app version information */
  version: string;
  /** Needs to be overridden for react-router */
  historyApiFallback?: DevServer["historyApiFallback"];
};

const devServer = (params: ConfigParams): DevServer => ({
  // Everything is served from memory; never serve stale files (e.g. a prod sw.js) from disk
  static: false,
  historyApiFallback: params.historyApiFallback,
  hot: true,
  // The problem and solution are described at <https://github.com/webpack/webpack-dev-server/issues/1604>.
  // When running in dev mode two errors are logged to the dev console:
  //  "Invalid Host/Origin header"
  //  "[WDS] Disconnected!"
  // Since we are only connecting to localhost, DNS rebinding attacks are not a concern during dev
  allowedHosts: "all",
  headers: {
    // Enable cross-origin isolation: https://resourcepolicy.fyi
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "credentialless",
  },

  client: {
    overlay:
      process.env.DISABLE_OVERLAY === "true"
        ? false
        : {
            runtimeErrors: isOverlayRuntimeError,
          },
  },
});

export const mainConfig =
  (params: ConfigParams) =>
  (env: unknown, argv: RspackArgv): Configuration => {
    const isDev = argv.mode === "development";
    const isServe = argv.env?.RSPACK_SERVE ?? false;

    const plugins: RspackPluginInstance[] = [];

    // "?raw" imports feed source text to the user script type checker and must stay untouched
    if (isServe) {
      plugins.push(new ReactRefreshRspackPlugin({ resourceQuery: { not: /raw/ } }));
    }

    // Runs on the files on disk after emit, so only for real builds (the dev server serves from memory)
    if (!isDev && !isServe) {
      plugins.push(startupBudgetPlugin);
      // Precache only the app shell; every other build file is hashed and cached on first use
      // (CacheFirst), so a first visit or a deploy no longer downloads the whole build (~35 MB).
      // index.tsx copies the chunks a first, uncontrolled visit loaded into the same cache, so
      // the installed PWA starts offline. Panels never opened online are not available offline.
      // The new version activates once all app windows are closed, or when the user clicks the
      // update button in the app bar (see useServiceWorkerUpdate.ts).
      plugins.push({
        apply: (compiler) => {
          compiler.hooks.afterEmit.tapPromise("GenerateSW", async () => {
            await generateSW({
              globDirectory: params.outputPath,
              globPatterns: [
                "index.html",
                "main.*.js",
                "manifest.webmanifest",
                "view-link-redirect.js",
                "favicon*",
                "*icon-*.png",
              ],
              swDest: path.join(params.outputPath, "sw.js"),
              // serve the precached app shell for any navigation (deep links, file_handlers launches)
              navigateFallback: "index.html",
              // registers its fetch listener first, so /<org>/view links redirect before the fallback
              importScripts: ["view-link-redirect.js"],
              cleanupOutdatedCaches: true,
              runtimeCaching: [
                {
                  // content-hashed file names never change content, so the cached copy is final
                  urlPattern: ({ url, sameOrigin }) =>
                    sameOrigin && /\/[\w.-]*[0-9a-f]{16}\.\w+$/.test(url.pathname),
                  handler: "CacheFirst",
                  options: {
                    cacheName: RUNTIME_CACHE_NAME,
                    // bounds the files kept from older deploys; a full build has ~300
                    expiration: { maxEntries: 1500, purgeOnQuotaError: true },
                  },
                },
              ],
            });
          });
        },
      });
    }

    const appConfig = makeConfig(env, argv, { version: params.version });

    return {
      name: "main",

      ...appConfig,

      // `rspack serve` compiles lazy imports on first use, and the recompile reloads every open page.
      // E2E tests run in parallel against one dev server, so build everything up front for them.
      ...(process.env.E2E === "true" && { lazyCompilation: false }),

      target: "web",
      context: params.contextPath,
      entry: params.entrypoint,
      devtool: isDev ? "eval-cheap-module-source-map" : params.prodSourceMap,
      devServer: devServer(params),

      output: {
        publicPath: params.publicPath ?? "auto",

        // Output filenames should include content hashes in order to cache bust when new versions are available
        filename: isDev ? "[name].js" : "[name].[contenthash].js",

        path: params.outputPath,
        clean: true,
      },

      plugins: [
        ...plugins,
        ...(appConfig.plugins ?? []),
        new rspack.CopyRspackPlugin({
          patterns: [
            { from: path.resolve(import.meta.dirname, "..", "public") },
            ...["LICENSE", "THIRD_PARTY_NOTICES"].map((name) => ({
              from: path.resolve(import.meta.dirname, "../../..", name),
              to: name,
              toType: "file" as const,
            })),
          ],
        }),
        new rspack.HtmlRspackPlugin({
          // Minifying would strip the default layout placeholder comment below
          minify: false,
          templateContent: `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <meta name="apple-mobile-web-app-capable" content="yes">
      <title>Lichtblick</title>
      <link rel="manifest" href="manifest.webmanifest" />
      <meta name="theme-color" content="${palette.dark.appBar.main}" />
      <link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png" />
      <link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png" />
      <link rel="icon" type="image/png" sizes="16x16" href="favicon-16x16.png" />
      <style type="text/css" id="loading-styles">
        body {
          margin: 0;
        }
        #root {
          height: 100vh;
          background-color: ${palette.light.background?.default};
          color: ${palette.light.text?.primary};
        }
        @media (prefers-color-scheme: dark) {
          #root {
            background-color: ${palette.dark.background?.default};
            color: ${palette.dark.text?.primary};
          }
        }
      </style>
      <script>
        global = globalThis;
        globalThis.LICHTBLICK_SUITE_DEFAULT_LAYOUT = [/*LICHTBLICK_SUITE_DEFAULT_LAYOUT_PLACEHOLDER*/][0];
      </script>
    </head>
    <body>
      <div id="root"></div>
    </body>
  </html>
  `,
        }),
      ],
    };
  };
