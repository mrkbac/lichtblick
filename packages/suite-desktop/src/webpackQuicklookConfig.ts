// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Configuration, rspack } from "@rspack/core";
import { ReactRefreshRspackPlugin } from "@rspack/plugin-react-refresh";
import HtmlWebpackPlugin from "html-webpack-plugin";
import path from "path";
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin";

import type { WebpackArgv } from "@lichtblick/suite-base/WebpackArgv";
import { swcRule, tsCheckerOptions } from "@lichtblick/suite-base/webpack";

import { WebpackConfigParams } from "./WebpackConfigParams";

export const webpackQuicklookConfig =
  (params: WebpackConfigParams) =>
  (_env: unknown, argv: WebpackArgv): Configuration => {
    const isDev = argv.mode === "development";
    const isServe = argv.env?.RSPACK_SERVE ?? false;

    const allowUnusedVariables = isDev && isServe;

    return {
      name: "quicklook",

      context: params.quicklookContext,
      entry: params.quicklookEntrypoint,
      target: "web",
      devtool: isDev ? "eval-cheap-module-source-map" : params.prodSourceMap,

      output: {
        publicPath: isServe ? "/quicklook/" : "",
        path: path.join(params.outputPath, "quicklook"),
      },

      module: {
        rules: [
          { test: /\.png$/, type: "asset/inline" },
          { test: /\.wasm$/, type: "asset/inline" },
          swcRule({ isDev, refresh: isServe }),
        ],
      },

      plugins: [
        new TsCheckerRspackPlugin({
          typescript: {
            ...tsCheckerOptions(),
            configOverwrite: {
              compilerOptions: {
                noUnusedLocals: !allowUnusedVariables,
                noUnusedParameters: !allowUnusedVariables,
              },
            },
          },
        }),
        new HtmlWebpackPlugin({
          templateContent: `
<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <script>
    global = globalThis;
  </script>
  <body>
    <div id="root"></div>
  </body>
</html>
`,
        }),
        new rspack.ProvidePlugin({
          // the buffer module exposes the Buffer class as a property
          Buffer: ["buffer", "Buffer"],
        }),
        ...(isServe ? [new ReactRefreshRspackPlugin({ resourceQuery: { not: /raw/ } })] : []),
      ],

      // webpack mocked these silently for web targets; the wasm decoders reference them
      node: { __dirname: "mock", __filename: "mock" },
      resolve: {
        extensions: [".js", ".ts", ".tsx", ".json"],
        fallback: {
          path: require.resolve("path-browserify"),
          stream: false,
          crypto: false,
          fs: false,
        },
      },
    };
  };
