// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Configuration, rspack } from "@rspack/core";
import { ReactRefreshRspackPlugin } from "@rspack/plugin-react-refresh";
import path from "path";

import type { RspackArgv } from "@lichtblick/suite-base/RspackArgv";
import { swcRule } from "@lichtblick/suite-base/rspack";

import { RspackConfigParams } from "./RspackConfigParams";

export const rspackQuicklookConfig =
  (params: RspackConfigParams) =>
  (_env: unknown, argv: RspackArgv): Configuration => {
    const isDev = argv.mode === "development";
    const isServe = argv.env?.RSPACK_SERVE ?? false;

    return {
      name: "quicklook",
      dependencies: ["root"],

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
        new rspack.HtmlRspackPlugin({
          templateContent: `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <script>
      global = globalThis;
    </script>
  </head>
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
