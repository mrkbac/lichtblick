// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Configuration, RspackPluginInstance, rspack } from "@rspack/core";
import { ReactRefreshRspackPlugin } from "@rspack/plugin-react-refresh";
import path from "node:path";

import type { RspackArgv } from "../packages/suite-base/RspackArgv";
import { makeConfig } from "../packages/suite-base/rspack";

const devServer: Configuration["devServer"] = {
  // Everything is served from memory; never serve stale files from disk
  static: false,
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
};

export default (env: unknown, argv: RspackArgv): Configuration => {
  const isDev = argv.mode === "development";
  const isServe = argv.env?.RSPACK_SERVE ?? false;

  const plugins: RspackPluginInstance[] = [];

  if (isServe) {
    plugins.push(new ReactRefreshRspackPlugin({ resourceQuery: { not: /raw/ } }));
  }

  const appConfig = makeConfig(env, argv, { version: "0.0.0-benchmark" });

  const config: Configuration = {
    name: "main",

    ...appConfig,

    target: "web",
    context: path.resolve(__dirname, "src"),
    entry: "./index.tsx",
    devtool: isDev ? "eval-cheap-module-source-map" : "source-map",
    devServer,

    output: {
      publicPath: "auto",

      // Output filenames should include content hashes in order to cache bust when new versions are available
      filename: isDev ? "[name].js" : "[name].[contenthash].js",
      path: path.resolve(__dirname, ".webpack"),
      clean: true,
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
      <title>Lichtblick Benchmark</title>
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
    ],
  };

  return config;
};
