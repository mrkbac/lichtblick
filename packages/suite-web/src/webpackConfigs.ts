// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Configuration, DevServer, RspackPluginInstance, rspack } from "@rspack/core";
import { ReactRefreshRspackPlugin } from "@rspack/plugin-react-refresh";
import HtmlWebpackPlugin from "html-webpack-plugin";
import path from "path";
import { GenerateSW } from "workbox-webpack-plugin";

import type { WebpackArgv } from "@lichtblick/suite-base/WebpackArgv";
import { makeConfig } from "@lichtblick/suite-base/webpack";
import * as palette from "@lichtblick/theme/src/palette";

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
  /** Customizations to index.html */
  indexHtmlOptions?: Partial<HtmlWebpackPlugin.Options>;
};

export const devServerConfig = (params: ConfigParams): Configuration => ({
  // Use empty entry to avoid webpack default fallback to /src
  entry: {},

  // Output path must be specified here for HtmlWebpackPlugin within render config to work
  output: {
    publicPath: params.publicPath ?? "",
    path: params.outputPath,
  },

  devServer: {
    static: {
      directory: params.outputPath,
    },
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
              runtimeErrors: (error) => {
                // Suppress overlays for importScript errors from terminated webworkers.
                //
                // When a webworker is terminated, any pending `importScript` calls are cancelled by the
                // browser. These appear in the devtools network tab as "(cancelled)" and bubble up to the
                // parent page as errors which trigger `window.onerror`.
                //
                // webpack devserver attaches to the window error handler surface unhandled errors sent to
                // the page. However this kind of error is a false-positive for a worker that is
                // terminated because we do not care that its network requests were cancelled since the
                // worker itself is gone.
                //
                // Will this hide real importScript errors during development?
                // It is possible that a worker encounters this error during normal operation (if
                // importing a script does fail for a legitimate reason). In that case we expect the
                // worker logic that depended on the script to fail execution and trigger other kinds of
                // errors. The developer can still see the importScripts error in devtools console.
                if (
                  error.message.startsWith(
                    `Uncaught NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope'`,
                  )
                ) {
                  return false;
                }
                // Benign per spec: observers whose callbacks resize content get re-delivered next frame.
                if (error.message.startsWith("ResizeObserver loop")) {
                  return false;
                }

                return true;
              },
            },
    },
  },
});

export const mainConfig =
  (params: ConfigParams) =>
  (env: unknown, argv: WebpackArgv): Configuration => {
    const isDev = argv.mode === "development";
    const isServe = argv.env?.RSPACK_SERVE ?? false;

    const allowUnusedVariables = isDev;

    const plugins: RspackPluginInstance[] = [];

    // "?raw" imports feed source text to the user script type checker and must stay untouched
    if (isServe) {
      plugins.push(new ReactRefreshRspackPlugin({ resourceQuery: { not: /raw/ } }));
    }

    if (!isDev) {
      // Precache the whole build so the installed PWA works fully offline, including lazy-loaded
      // panels, workers and wasm. The new version activates once all app windows are closed, or
      // when the user accepts the update prompt (see registerServiceWorker.ts).
      plugins.push(
        new GenerateSW({
          swDest: "sw.js",
          exclude: [/\.map$/, /\.LICENSE\.txt$/],
          // serve the precached app shell for any navigation (deep links, file_handlers launches)
          navigateFallback: "index.html",
          maximumFileSizeToCacheInBytes: 100 * 1024 * 1024,
          cleanupOutdatedCaches: true,
        }),
      );
    }

    const appWebpackConfig = makeConfig(env, argv, {
      allowUnusedVariables,
      version: params.version,
    });

    const config: Configuration = {
      name: "main",

      ...appWebpackConfig,

      target: "web",
      context: params.contextPath,
      entry: params.entrypoint,
      devtool: isDev ? "eval-cheap-module-source-map" : params.prodSourceMap,

      output: {
        publicPath: params.publicPath ?? "auto",

        // Output filenames should include content hashes in order to cache bust when new versions are available
        filename: isDev ? "[name].js" : "[name].[contenthash].js",

        path: params.outputPath,
        clean: true,
      },

      plugins: [
        ...plugins,
        ...(appWebpackConfig.plugins ?? []),
        new rspack.CopyRspackPlugin({
          patterns: [{ from: path.resolve(__dirname, "..", "public") }],
        }),
        new HtmlWebpackPlugin({
          templateContent: ({ htmlWebpackPlugin }) => `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <meta name="apple-mobile-web-app-capable" content="yes">
      ${htmlWebpackPlugin.options.foxgloveExtraHeadTags}
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
            background-color: ${palette.dark.background?.default}};
            color: ${palette.dark.text?.primary};
          }
        }
      </style>
    </head>
    <script>
      global = globalThis;
      globalThis.LICHTBLICK_SUITE_DEFAULT_LAYOUT = [/*LICHTBLICK_SUITE_DEFAULT_LAYOUT_PLACEHOLDER*/][0];
    </script>
    <body>
      <div id="root"></div>
    </body>
  </html>
  `,
          foxgloveExtraHeadTags: `
            <title>Lichtblick</title>
            <link rel="manifest" href="manifest.webmanifest" />
            <meta name="theme-color" content="${palette.dark.appBar.main}" />
            <link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png" />
            <link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png" />
            <link rel="icon" type="image/png" sizes="16x16" href="favicon-16x16.png" />
          `,
          ...params.indexHtmlOptions,
        }),
      ],
    };

    return config;
  };
