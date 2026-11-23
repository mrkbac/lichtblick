// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  type Compilation,
  type Configuration,
  type DevServer,
  type RspackPluginInstance,
  rspack,
} from "@rspack/core";
import { ReactRefreshRspackPlugin } from "@rspack/plugin-react-refresh";
import { writeFile } from "fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import path from "path";
import { generateSW } from "workbox-build";

import type { RspackArgv } from "@lichtblick/suite-base/RspackArgv.ts";
import {
  isOverlayRuntimeError,
  makeConfig,
  type ProductInfo,
} from "@lichtblick/suite-base/rspack.ts";
import * as palette from "@lichtblick/theme/src/palette.ts";

import { ASSET_LIST_FILE, type AssetList, HASHED_FILE, RUNTIME_CACHE_NAME } from "./assetCache.ts";
// Match the worker runtime to the versioned static WASM across web deployments.
const { version } = createRequire(import.meta.url)("@ai-ecoverse/wasm-tailscale/package.json") as {
  version: string;
};
const tailscaleAsset = `tailscale/client-${version}.wasm.gz`;

/**
 * Upper bound for the JS the web app loads before its first render: the entry chunk plus the
 * chunks index.tsx imports while starting (named "startup-*"). The build fails above it, so a
 * shared module that pulls in a panel's heavy dependencies (three.js, monaco, a player) is caught
 * in CI instead of slowing every start. Raise it only for code that is needed to show the app.
 */
const STARTUP_JS_BUDGET_BYTES = 3_800_000;

/**
 * Unhashed scripts in public/ that the service worker imports, in this order, before workbox's own
 * fetch listener: view-link-redirect.js redirects /<org>/view links before the app-shell fallback,
 * sw-worker-owners.js remembers which window created each worker. web/.cloudflare/_headers keeps
 * them uncached so new deploys reach them.
 */
const SW_IMPORT_SCRIPTS = ["view-link-redirect.js", "sw-worker-owners.js"];

/**
 * Files (name to size) the app needs to start: the entry chunk group plus the "startup-*" groups
 * index.tsx imports, with their fonts and other assets. Source maps excluded.
 */
function startupAssets(compilation: Compilation): Map<string, number> {
  const { namedChunkGroups = {} } = compilation.getStats().toJson({
    all: false,
    chunkGroups: true,
    assets: true,
  });
  if (!namedChunkGroups["startup-app"] || !namedChunkGroups["startup-webroot"]) {
    throw new Error("The startup-* chunk groups are missing, see index.tsx");
  }
  const files = new Map<string, number>();
  for (const [name, group] of Object.entries(namedChunkGroups)) {
    if (name === "main" || name.startsWith("startup-")) {
      for (const asset of [...(group.assets ?? []), ...(group.auxiliaryAssets ?? [])]) {
        if (!asset.name.endsWith(".map")) {
          files.set(asset.name, asset.size ?? 0);
        }
      }
    }
  }
  return files;
}

/**
 * Fails the build when the startup chunks exceed STARTUP_JS_BUDGET_BYTES, and lists them in
 * startup-js.json for ci/perf-budget.ts.
 */
const startupBudgetPlugin: RspackPluginInstance = {
  apply: (compiler) => {
    compiler.hooks.afterEmit.tapPromise("StartupBudget", async (compilation) => {
      const files = new Map(
        [...startupAssets(compilation)].filter(([file]) => file.endsWith(".js")),
      );
      await writeFile(
        path.join(compiler.outputPath, "startup-js.json"),
        JSON.stringify([...files.keys()]) ?? "",
      );
      const total = [...files.values()].reduce((sum, size) => sum + size, 0);
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
  /** Name and links for the UI, page title and web manifest */
  product: ProductInfo;
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
      // Precache only what the app needs to start (shell and startup chunks, ~4 MB), so an
      // installed update starts offline too. Every other build file is hashed and cached on first
      // use (CacheFirst), so a browser tab never downloads the whole build (~25 MB). index.tsx
      // copies the chunks a first, uncontrolled visit loaded into the same cache, and the
      // installed app downloads the rest of ASSET_LIST_FILE in the background, so every panel
      // works offline there.
      // The new version activates once all app windows are closed, or when the user clicks the
      // update button in the app bar (see useServiceWorkerUpdate.ts).
      plugins.push({
        apply: (compiler) => {
          compiler.hooks.afterEmit.tapPromise("GenerateSW", async (compilation) => {
            const names = compilation.getAssets().map((asset) => asset.name);
            // web/.cloudflare/_headers caches these types for a year without revalidating
            const frozen = names.filter(
              (name) =>
                /\.(js|mjs|wasm|woff2|ttf)$/.test(name) &&
                !HASHED_FILE.test(`/${name}`) &&
                !SW_IMPORT_SCRIPTS.includes(name),
            );
            if (frozen.length > 0) {
              throw new Error(
                `Unhashed build files would be cached for a year (see web/.cloudflare/_headers): ${frozen.join(", ")}`,
              );
            }
            const assetList: AssetList = {
              version: params.version,
              files: names.filter((name) => HASHED_FILE.test(`/${name}`)),
            };
            await writeFile(
              path.join(params.outputPath, ASSET_LIST_FILE),
              JSON.stringify(assetList) ?? "",
            );
            await generateSW({
              globDirectory: params.outputPath,
              globPatterns: [
                "index.html",
                "main.*.js",
                "manifest.webmanifest",
                ...SW_IMPORT_SCRIPTS,
                "favicon*",
                "*icon-*.png",
                // startup waits for every font face (see waitForFonts.ts)
                "*.woff2",
                ...startupAssets(compilation).keys(),
              ],
              // hashed names change with their content: fetch them as is, so the browser can reuse
              // what the page already downloaded instead of loading every file a second time
              dontCacheBustURLsMatching: /[0-9a-f]{16}\.\w+$/,
              swDest: path.join(params.outputPath, "sw.js"),
              // serve the precached app shell for any navigation (deep links, file_handlers launches)
              navigateFallback: "index.html",
              // their fetch listeners run before workbox's (see SW_IMPORT_SCRIPTS)
              importScripts: SW_IMPORT_SCRIPTS,
              cleanupOutdatedCaches: true,
              runtimeCaching: [
                {
                  // content-hashed file names never change content, so the cached copy is final.
                  // HASHED_FILE inlined: workbox copies this function's source into sw.js.
                  urlPattern: ({ url, sameOrigin }) =>
                    sameOrigin && /\/[\w.-]*[0-9a-f]{16}\.\w+$/.test(url.pathname),
                  handler: "CacheFirst",
                  options: {
                    cacheName: RUNTIME_CACHE_NAME,
                    // bounds the files kept from older deploys; a full build has ~300
                    expiration: { maxEntries: 1500, purgeOnQuotaError: true },
                    plugins: [
                      {
                        // The host answers unknown paths (e.g. a chunk removed by a newer deploy)
                        // with index.html and status 200. Never cache that as the file.
                        cacheWillUpdate: async ({ response }) =>
                          response.ok &&
                          response.headers.get("content-type")?.startsWith("text/html") !== true
                            ? response
                            : null,
                        // That index.html means the asking page runs an older build whose file is
                        // gone. Tell it, so it switches (recoverFromMissingAssets); a worker can't
                        // reload, so a request from one is reported to every window. Self-contained:
                        // workbox copies this source into sw.js.
                        fetchDidSucceed: async ({ request, response, event }) => {
                          if (
                            response.headers.get("content-type")?.startsWith("text/html") !==
                              true ||
                            // the page's own prefetch (PREFETCH_HEADER), not a file it needs
                            request.headers.has("x-lichtblick-prefetch")
                          ) {
                            return response;
                          }
                          type Client = { type: string; postMessage: (message: unknown) => void };
                          const sw = self as unknown as {
                            clients: { matchAll: (options: { type: string }) => Promise<Client[]> };
                            // sw-worker-owners.js
                            lichtblickOwningWindow?: (
                              clientId: string,
                            ) => Promise<Client | undefined>;
                          };
                          const clientId = (event as { clientId?: string } | undefined)?.clientId;
                          // a worker's request goes to the window that created the worker
                          const owner = clientId
                            ? await sw.lichtblickOwningWindow?.(clientId)
                            : undefined;
                          const direct = owner != undefined;
                          const targets = owner
                            ? [owner]
                            : await sw.clients.matchAll({ type: "window" });
                          for (const target of targets) {
                            target.postMessage({
                              type: "lichtblick.missingAsset",
                              url: request.url,
                              direct,
                            });
                          }
                          return response;
                        },
                      },
                    ],
                  },
                },
              ],
            });
          });
        },
      });
    }

    const appConfig = makeConfig(env, argv, {
      version: params.version,
      product: params.product,
    });

    return {
      name: "main",

      ...appConfig,

      // `rspack serve` compiles lazy imports on first use, and the recompile reloads every open page.
      // E2E tests run in parallel against one dev server, so build everything up front for them.
      ...(process.env.E2E === "true" && { lazyCompilation: false }),
      // Each lazy compile adds modules to the shared split chunks, and their names (derived from
      // the modules they hold) change with it. A page still loading the previous build then asks
      // for chunk files that no longer exist (404, "Chunk is from another build"). Without split
      // chunks every async chunk keeps its name across lazy compiles.
      ...(isServe && { optimization: { splitChunks: false } }),

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
        new rspack.DefinePlugin({ TAILSCALE_WASM_ASSET: JSON.stringify(tailscaleAsset) }),
        ...(appConfig.plugins ?? []),
        new rspack.CopyRspackPlugin({
          patterns: [
            {
              from: fileURLToPath(import.meta.resolve("@ai-ecoverse/wasm-tailscale/main.wasm")),
              to: tailscaleAsset,
              transform: (input) => gzipSync(input),
            },
            ...["LICENSE", "THIRD-PARTY-NOTICES.md"].map((name) => ({
              from: path.join(
                path.dirname(
                  fileURLToPath(import.meta.resolve("@ai-ecoverse/wasm-tailscale/package.json")),
                ),
                name,
              ),
              to: `tailscale/${name}`,
              toType: "file" as const,
            })),
            {
              from: path.resolve(import.meta.dirname, "..", "public"),
              // Name and colors come from package.json productName and the theme palette
              transform: (input, absoluteFilename) =>
                absoluteFilename.endsWith("manifest.webmanifest")
                  ? JSON.stringify({
                      ...(JSON.parse(input.toString()) as Record<string, unknown>),
                      name: params.product.name,
                      short_name: params.product.name,
                      background_color: palette.dark.background?.default,
                      theme_color: palette.dark.appBar.main,
                    })!
                  : input,
            },
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
      <title>${params.product.name}</title>
      <link rel="manifest" href="manifest.webmanifest" />
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="${palette.light.appBar.main}" />
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="${palette.dark.appBar.main}" />
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
