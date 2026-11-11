// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { type Configuration, type RspackPluginInstance, rspack } from "@rspack/core";
import { ReactRefreshRspackPlugin } from "@rspack/plugin-react-refresh";
import path from "path";

import type { RspackArgv } from "@lichtblick/suite-base/RspackArgv.ts";
import { isOverlayRuntimeError, makeConfig } from "@lichtblick/suite-base/rspack.ts";
import * as palette from "@lichtblick/theme/src/palette.ts";

import type { RspackConfigParams } from "./RspackConfigParams.ts";

export const rspackRendererConfig =
  (params: RspackConfigParams) =>
  (env: unknown, argv: RspackArgv): Configuration => {
    const isDev = argv.mode === "development";
    const isServe = argv.env?.RSPACK_SERVE ?? false;

    const plugins: RspackPluginInstance[] = [];

    if (isServe) {
      plugins.push(new ReactRefreshRspackPlugin({ resourceQuery: { not: /raw/ } }));
    }

    const appConfig = makeConfig(env, argv, {
      version: params.packageJson.version,
    });

    const config: Configuration = {
      ...appConfig,
      name: "renderer",
      dependencies: ["root"],

      // force web target instead of electron-render
      // Fixes "require is not defined" errors if nodeIntegration is off
      // https://gist.github.com/msafi/d1b8571aa921feaaa0f893ab24bb727b
      target: "web",
      context: params.rendererContext,
      entry: params.rendererEntrypoint,
      devtool: isDev ? "eval-cheap-module-source-map" : params.prodSourceMap,
      devServer: {
        static: {
          directory: params.outputPath,
        },
        devMiddleware: {
          writeToDisk: (filePath) => {
            // Electron needs to open the main thread source and preload source from disk
            // avoid writing the hot-update js and json files
            // allow writing package.json at root -> needed for electron to find entrypoint
            return /\.webpack[\\/]((main|extensions)[\\/](?!.*hot-update)|package\.json)/.test(
              filePath,
            );
          },
        },
        client: {
          overlay: {
            runtimeErrors: isOverlayRuntimeError,
          },
        },
        hot: true,
        // The problem and solution are described at <https://github.com/webpack/webpack-dev-server/issues/1604>.
        // When running in dev mode two errors are logged to the dev console:
        //  "Invalid Host/Origin header"
        //  "[WDS] Disconnected!"
        // Since we are only connecting to localhost, DNS rebinding attacks are not a concern during dev
        allowedHosts: "all",
      },

      output: {
        publicPath: isServe ? "/renderer/" : "",
        path: path.join(params.outputPath, "renderer"),
      },

      plugins: [
        ...plugins,
        ...(appConfig.plugins ?? []),
        new rspack.HtmlRspackPlugin({
          templateContent: `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <script>
        global = globalThis;
      </script>
      <style>
        html, body {
          background-color: ${palette.light.background?.default};
          color: ${palette.light.text?.primary};
        }
        @media (prefers-color-scheme: dark) {
          html, body {
            background-color: ${palette.dark.background?.default};
            color: ${palette.dark.text?.primary};
          }
        }
      </style>
    </head>
    <body>
      <div id="root"></div>
    </body>
  </html>
  `,
        }),
      ],
    };

    return config;
  };
