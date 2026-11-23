// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { type Configuration, type RspackPluginInstance, rspack } from "@rspack/core";
import { ReactRefreshRspackPlugin } from "@rspack/plugin-react-refresh";
import fs from "node:fs";
import path from "node:path";

import { resolveConfigs, type RspackArgv } from "@lichtblick/suite-base/RspackArgv.ts";
import {
  isOverlayRuntimeError,
  makeConfig,
  productInfo,
  swcRule,
} from "@lichtblick/suite-base/rspack.ts";
import * as palette from "@lichtblick/theme/src/palette.ts";

import packageJson from "../../package.json" with { type: "json" };

// Load .env if present (Node's built-in loader; existing env vars win)
const envFile = path.resolve(import.meta.dirname, "../../.env");
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const outputPath = path.resolve(import.meta.dirname, ".webpack");
// Maps stay next to the build for debugging; electronBuilderConfig.js keeps them out of the app
const prodSourceMap = "hidden-source-map";
const entryContext = path.resolve(import.meta.dirname, "src/entry");

/**
 * Cleans the output directory and writes the `package.json` Electron reads to find its main entry.
 * The dev server itself is configured on the renderer config.
 */
const rootConfig = (_: unknown, argv: RspackArgv): Configuration => {
  const isRelease = argv.mode === "production";

  // The appdata directory is derived from the product name. To have a separate directory
  // for our production and development builds we change the product name when using dev or serve.
  const productName = isRelease ? packageJson.productName : `${packageJson.productName} Dev`;

  return {
    name: "root",
    // Use empty entry to avoid the default fallback to /src
    entry: {},

    output: {
      publicPath: "",
      path: outputPath,
      clean: true,
    },

    plugins: [
      // Electron (and electron-builder) read package.json to find the entry script
      new rspack.CopyRspackPlugin({
        patterns: [
          ...["LICENSE", "THIRD_PARTY_NOTICES"].map((name) => ({
            from: path.resolve(import.meta.dirname, "../..", name),
            to: name,
            toType: "file" as const,
          })),
          {
            from: path.resolve(import.meta.dirname, "../../package.json"),
            transform: () =>
              JSON.stringify({
                main: "main/main.js",
                name: packageJson.name,
                productName,
                version: packageJson.version,
                description: packageJson.description,
                productDescription: packageJson.productDescription,
                license: packageJson.license,
                author: packageJson.author,
              }),
          },
        ],
      }),
    ],
  };
};

/** Shared by the Electron main and preload bundles. */
function electronConfig(argv: RspackArgv, defines: Record<string, string> = {}): Configuration {
  const isDev = argv.mode === "development";
  return {
    // root cleans the output directory first
    dependencies: ["root"],
    context: entryContext,
    devtool: isDev ? "eval-cheap-module-source-map" : prodSourceMap,
    module: {
      rules: [swcRule({ isDev })],
    },
    plugins: [
      new rspack.DefinePlugin({
        // Should match common/webpackDefines.ts
        LICHTBLICK_PRODUCT_NAME: JSON.stringify(packageJson.productName),
        LICHTBLICK_PRODUCT_VERSION: JSON.stringify(packageJson.version),
        LICHTBLICK_PRODUCT_HOMEPAGE: JSON.stringify(packageJson.homepage),
        // Read by suite-base code bundled into main (constants/config.ts)
        LICHTBLICK_REPOSITORY_URL: JSON.stringify(productInfo(packageJson).repositoryUrl),
        LICHTBLICK_SUITE_VERSION: JSON.stringify(packageJson.version),
        API_URL: process.env.API_URL ? JSON.stringify(process.env.API_URL) : undefined,
        ...defines,
      }),
    ],
    resolve: {
      extensions: [".js", ".ts", ".tsx", ".json"],
    },
  };
}

const mainConfig = (_: unknown, argv: RspackArgv): Configuration => {
  const isServe = argv.env?.RSPACK_SERVE ?? false;
  const isDev = argv.mode === "development";

  // When running under a development server the renderer entry comes from the server.
  // When making static builds (for packaging), the renderer entry is a file on disk.
  const rendererEntry = isServe
    ? `"http://${argv.host ?? "localhost"}:8080/renderer/index.html"`
    : "`file://${require('path').join(__dirname, '..', 'renderer', 'index.html')}`";

  const common = electronConfig(argv, { MAIN_WINDOW_WEBPACK_ENTRY: rendererEntry });
  return {
    ...common,
    name: "main",
    entry: "./main.ts",
    target: "electron-main",
    output: {
      publicPath: "",
      path: path.join(outputPath, "main"),
    },
    resolve: {
      ...common.resolve,
      // Stub out devtools installation for non-dev builds
      ...(!isDev && { alias: { "electron-devtools-installer": false } }),
    },
  };
};

const preloadConfig = (_: unknown, argv: RspackArgv): Configuration => ({
  ...electronConfig(argv),
  name: "preload",
  entry: "./preload.ts",
  target: "electron-preload",
  output: {
    publicPath: "",
    filename: "preload.js",
    path: path.join(outputPath, "main"),
  },
});

const rendererConfig = (env: unknown, argv: RspackArgv): Configuration => {
  const isDev = argv.mode === "development";
  const isServe = argv.env?.RSPACK_SERVE ?? false;

  const plugins: RspackPluginInstance[] = [];

  if (isServe) {
    plugins.push(new ReactRefreshRspackPlugin({ resourceQuery: { not: /raw/ } }));
  }

  const appConfig = makeConfig(env, argv, {
    version: packageJson.version,
    product: productInfo(packageJson),
  });

  return {
    ...appConfig,
    name: "renderer",
    dependencies: ["root"],

    // force web target instead of electron-render
    // Fixes "require is not defined" errors if nodeIntegration is off
    // https://gist.github.com/msafi/d1b8571aa921feaaa0f893ab24bb727b
    target: "web",
    context: entryContext,
    entry: "./renderer.tsx",
    devtool: isDev ? "eval-cheap-module-source-map" : prodSourceMap,
    devServer: {
      static: {
        directory: outputPath,
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
      path: path.join(outputPath, "renderer"),
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
};

export default (env: unknown, argv: RspackArgv): Configuration[] =>
  resolveConfigs(env, argv, [rootConfig, mainConfig, preloadConfig, rendererConfig]);
