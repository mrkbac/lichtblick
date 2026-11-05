// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { type Configuration, type RuleSetRule, rspack } from "@rspack/core";
import dotenv from "dotenv";
import { createRequire as _nodeCreateRequire } from "node:module";
import { fileURLToPath as _nodeFileURLToPath, pathToFileURL as _nodePathToFileURL } from "node:url";

import type { RspackArgv } from "./RspackArgv.ts";

/**
 * Transpiles TypeScript/TSX with Rspack's built-in SWC loader (type checking runs separately with
 * `pnpm typecheck`). `refresh` enables React Fast Refresh for the dev server.
 */
export function swcRule({
  isDev,
  refresh = false,
}: {
  isDev: boolean;
  refresh?: boolean;
}): RuleSetRule {
  return {
    test: /\.tsx?$/,
    exclude: /node_modules/,
    loader: "builtin:swc-loader",
    options: {
      jsc: {
        parser: { syntax: "typescript", tsx: true },
        target: "es2022",
        transform: {
          react: { runtime: "automatic", development: isDev, refresh },
        },
      },
    },
    type: "javascript/auto",
  };
}

let currentDirHref: string | undefined;
let localRequireInstance: NodeJS.Require | undefined;

function initModuleLocals(packageDir: string | undefined): void {
  if (currentDirHref != undefined) {
    return;
  }
  const dir = packageDir ?? import.meta.dirname;
  const dirHref = _nodePathToFileURL(dir + "/").href;
  currentDirHref = dirHref;
  localRequireInstance = _nodeCreateRequire(dir + "/package.json");
  // Load environment variables from .env.local
  dotenv.config({ path: _nodeFileURLToPath(new URL("../../.env", dirHref)) });
}

type Options = {
  /** Specify the app version. */
  version: string;
  /**
   * Absolute path to the @lichtblick/suite-base package directory.
   * Defaults to the directory of this file.
   */
  packageDir?: string;
};

function buildEnvVars(): Record<string, string | undefined> {
  return {
    "process.env.DEV_WORKSPACE": JSON.stringify(process.env.DEV_WORKSPACE),
  };
}

// Create a partial webpack configuration required to build app using webpack.
// Returns a webpack configuration containing resolve, module, plugins, and node fields.
export function makeConfig(
  _: unknown,
  argv: RspackArgv,
  options: Options,
): Pick<Configuration, "resolve" | "module" | "plugins" | "node" | "ignoreWarnings"> {
  initModuleLocals(options.packageDir);
  // After initModuleLocals, currentDirHref and localRequireInstance are guaranteed to be set.
  const dirHref = currentDirHref!;
  const localRequire = localRequireInstance!;

  const isDev = argv.mode === "development";
  const isServe = argv.env?.RSPACK_SERVE ?? false;

  const { version } = options;

  return {
    resolve: {
      extensions: [".js", ".ts", ".jsx", ".tsx"],
      alias: {
        "@lichtblick/suite-base": _nodeFileURLToPath(new URL("src", dirHref)),
        // Apps outside suite-base (web/src, desktop/renderer) don't depend on react themselves, and
        // pnpm doesn't hoist it, so JSX there resolves the runtime from suite-base.
        "react/jsx-runtime": localRequire.resolve("react/jsx-runtime"),
        "react/jsx-dev-runtime": localRequire.resolve("react/jsx-dev-runtime"),
        // Run Monaco's TS worker on our `typescript` instead of the copy Monaco bundles.
        ...Object.fromEntries(
          [
            ["typescriptServices", "monacoTypescript"],
            ["lib", "monacoTypescriptLibs"],
            ["lib.index", "monacoTypescriptLibs"],
          ].map(([monacoFile, ourFile]) => [
            localRequire.resolve(
              `monaco-editor/languages/features/typescript/lib/${monacoFile}.js`,
            ),
            _nodeFileURLToPath(new URL(`src/panels/UserScriptEditor/${ourFile}.ts`, dirHref)),
          ]),
        ),
      },
      // Node built-ins still imported by browser code. Everything else resolves on its own.
      fallback: {
        path: localRequire.resolve("path-browserify"),
        stream: localRequire.resolve("readable-stream"),
        // Only reached by Node-only code paths (sql.js, TypeScript, wasm decoders)
        crypto: false,
        fs: false,
        module: false,
        perf_hooks: false,
      },
    },
    module: {
      rules: [
        // Add support for native node modules
        {
          test: /\.node$/,
          use: "node-loader",
        },
        {
          test: /\.wasm$/,
          type: "asset/resource",
        },
        {
          // MapLibre's self-contained worker, loaded by URL (see panels/Map/initPanel.tsx)
          test: /maplibre-gl-worker\.mjs$/,
          type: "asset/resource",
        },
        {
          // MapLibre resolves runtime URLs with `new URL(variable, import.meta.url)`, which webpack
          // would try to bundle. The worker URL is set explicitly instead.
          test: /maplibre-gl\.mjs$/,
          parser: { url: false },
        },
        {
          // xmlbuilder2 (via @foxglove/xmlrpc) imports domainToASCII/domainToUnicode from Node's
          // "url". An alias, not a fallback: the npm "url" package (used by geotiff) resolves first
          // and lacks those exports.
          test: /[\\/]node_modules[\\/]@oozcitak[\\/]url[\\/]/,
          resolve: {
            alias: {
              url$: _nodeFileURLToPath(new URL("src/util/shims/url.ts", dirHref)),
            },
          },
        },
        {
          ...swcRule({ isDev, refresh: isServe }),
          resourceQuery: { not: [/raw/] },
        },
        {
          // "?raw" imports are used to load the original un-modified source
          // https://webpack.js.org/guides/asset-modules/#replacing-inline-loader-syntax
          resourceQuery: /raw/,
          type: "asset/source",
        },
        { test: /\.(md|template)$/, type: "asset/source" },
        {
          test: /\.svg$/,
          loader: localRequire.resolve("@svgr/webpack"),
          options: {
            svgo: {
              plugins: [{ removeViewBox: false }, { removeDimensions: false }],
            },
          },
        },
        { test: /\.ne$/, loader: localRequire.resolve("nearley-loader") },
        {
          test: /\.(png|jpg|gif)$/i,
          type: "asset",
          parser: {
            dataUrlCondition: {
              maxSize: 8 * 1024, // 8kb
            },
          },
        },
        {
          test: /\.css$/,
          loader: localRequire.resolve("style-loader"),
          sideEffects: true,
        },
        {
          test: /\.css$/,
          loader: localRequire.resolve("css-loader"),
          options: { sourceMap: true },
        },
        { test: /\.woff2?$/, type: "asset/inline" },
        { test: /\.(glb|bag|ttf|bin)$/, type: "asset/resource" },
      ],
    },
    plugins: [
      new rspack.ProvidePlugin({
        // Some dependencies call Buffer without importing it (@foxglove/wasm-zstd, wasm-lz4,
        // xmlrpc, @oozcitak/infra). Our own code must not rely on this.
        Buffer: ["buffer", "Buffer"],
      }),
      new rspack.DefinePlugin({
        // Should match webpack-defines.d.ts
        LICHTBLICK_SUITE_VERSION: JSON.stringify(version),
        // licht deploys talk to its organization server unless API_URL says otherwise.
        API_URL: JSON.stringify(process.env.API_URL ?? "https://licht-server.marko.im"),
        DEV_WORKSPACE: JSON.stringify(process.env.DEV_WORKSPACE),
        OTLP_ENDPOINT: JSON.stringify(process.env.OTLP_ENDPOINT),
        ...buildEnvVars(),
      }),
    ],
    node: {
      __dirname: true,
      __filename: true,
    },
    ignoreWarnings: [
      {
        module: /node_modules\/typescript\/lib\/typescript\.js$/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
      {
        module: /node_modules\/@protobufjs\/inquire\/index\.js$/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
    ],
  };
}
