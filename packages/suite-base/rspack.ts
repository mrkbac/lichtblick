// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Configuration, RuleSetRule, rspack } from "@rspack/core";
import dotenv from "dotenv";
import MonacoWebpackPlugin from "monaco-editor-webpack-plugin";
import { createRequire as _nodeCreateRequire } from "node:module";
import {
  fileURLToPath as _nodeFileURLToPath,
  pathToFileURL as _nodePathToFileURL,
} from "node:url";

import { RspackArgv } from "./RspackArgv";

/**
 * Transpiles TypeScript/TSX with Rspack's built-in SWC loader (type checking runs separately with
 * `yarn typecheck`). `refresh` enables React Fast Refresh for the dev server.
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
        parser: { syntax: "typescript", tsx: true, decorators: true },
        target: "es2022",
        transform: {
          // matches experimentalDecorators / emitDecoratorMetadata in tsconfig
          legacyDecorator: true,
          decoratorMetadata: true,
          react: { runtime: "automatic", development: isDev, refresh },
        },
      },
    },
    type: "javascript/auto",
  };
}

// In CJS (ts-node / webpack-cli), __dirname is injected by Node's module wrapper.
// In ESM (Storybook 10+), __dirname is undefined; callers must provide `packageDir`.
// We avoid import.meta.url here to stay compatible with "module: commonjs" TypeScript compilation
// (e.g. webpack-cli's ts-node with the root tsconfig) and Node.js 24's loadESMFromCJS detection.
// eslint-disable-next-line no-var, no-underscore-dangle
declare var __dirname: string | undefined;

let currentDirHref: string | undefined;
let localRequireInstance: NodeJS.Require | undefined;

function initModuleLocals(packageDir: string | undefined): void {
  if (currentDirHref != undefined) {
    return;
  }
  const dir = packageDir ?? __dirname;
  if (dir == undefined) {
    throw new Error(
      "makeConfig: cannot determine the @lichtblick/suite-base package directory. " +
        "Pass the `packageDir` option when calling makeConfig in ESM environments.",
    );
  }
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
   * Required in ESM environments (e.g. Storybook) where __dirname is not available.
   * Example: `new URL("../packages/suite-base", import.meta.url).pathname`
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
): Pick<
  Configuration,
  "resolve" | "module" | "plugins" | "node" | "ignoreWarnings"
> {
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
      },
      // Node built-ins still imported by browser code. Everything else resolves on its own.
      fallback: {
        path: localRequire.resolve("path-browserify"), // foxglove-depcheck-used: path-browserify
        stream: localRequire.resolve("readable-stream"), // foxglove-depcheck-used: readable-stream
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
              url$: _nodeFileURLToPath(
                new URL("src/util/shims/url.ts", dirHref),
              ),
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
          loader: "@svgr/webpack", // foxglove-depcheck-used: @svgr/webpack
          options: {
            svgo: {
              plugins: [{ removeViewBox: false }, { removeDimensions: false }],
            },
          },
        },
        { test: /\.ne$/, loader: "nearley-loader" }, // foxglove-depcheck-used: nearley-loader
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
          loader: "style-loader", // foxglove-depcheck-used: style-loader
          sideEffects: true,
        },
        {
          test: /\.css$/,
          loader: "css-loader", // foxglove-depcheck-used: css-loader
          options: { sourceMap: true },
        },
        { test: /\.woff2?$/, type: "asset/inline" },
        { test: /\.(glb|bag|ttf|bin)$/, type: "asset/resource" },
        {
          // TypeScript uses dynamic requires()s when running in node. We can disable these when we
          // bundle it for the renderer.
          // https://github.com/microsoft/TypeScript/issues/39436
          // Prettier's TS parser also bundles the same code: https://github.com/prettier/prettier/issues/11076
          test: /[\\/]node_modules[\\/]typescript[\\/]lib[\\/]typescript\.js$|[\\/]node_modules[\\/]prettier[\\/]plugins[\\/]typescript\.m?js$/,
          loader: "string-replace-loader", // foxglove-depcheck-used: string-replace-loader
          options: {
            multiple: [
              {
                search: /etwModule\s*=\s*require\(etwModulePath\);/,
                replace:
                  "throw new Error('[Foxglove] This module is not supported in the browser.');",
              },
              {
                search: `typescript-etw";r=require(i)`,
                replace: `typescript-etw";throw new Error('[Foxglove] This module is not supported in the browser.');`,
              },
              {
                search:
                  "return { module: require(modulePath), modulePath: modulePath, error: undefined };",
                replace:
                  "throw new Error('[Foxglove] This module is not supported in the browser.');",
              },
              {
                search: `return{module:require(n),modulePath:n,error:void 0}`,
                replace:
                  "throw new Error('[Foxglove] This module is not supported in the browser.');",
              },
              {
                search: `return { module:   require(modulePath), modulePath, error: void 0 };`,
                replace: `throw new Error('[Foxglove] This module is not supported in the browser.');`,
              },
              {
                search: `getModuleResolver=function(e){let t;try{t=require(e)}`,
                replace:
                  "getModuleResolver=function(e){let t;try{throw new Error('[Foxglove] This module is not supported in the browser.')}",
              },
            ],
          },
        },
      ],
    },
    plugins: [
      new rspack.ProvidePlugin({
        // since we avoid "import React from 'react'" we shim here when used globally
        React: "react",
        // the buffer module exposes the Buffer class as a property
        Buffer: ["buffer", "Buffer"],
        process: ["@lichtblick/suite-base/util/process", "default"],
        setImmediate: ["@lichtblick/suite-base/util/setImmediate", "default"],
      }),
      new rspack.DefinePlugin({
        // Should match webpack-defines.d.ts
        ReactNull: null,
        LICHTBLICK_SUITE_VERSION: JSON.stringify(version),
        // licht deploys talk to its organization server unless API_URL says otherwise.
        API_URL: JSON.stringify(
          process.env.API_URL ?? "https://licht-server.marko.im",
        ),
        DEV_WORKSPACE: JSON.stringify(process.env.DEV_WORKSPACE),
        OTLP_ENDPOINT: JSON.stringify(process.env.OTLP_ENDPOINT),
        ...buildEnvVars(),
      }),
      new MonacoWebpackPlugin({
        // available options: https://github.com/Microsoft/monaco-editor-webpack-plugin#options
        languages: ["typescript", "javascript"],

        // Output filenames should include content hashes in order to avoid caching issues with
        // downstream users of the suite-base package.
        filename: "[name].worker.[contenthash].js",
      }),
    ],
    node: {
      __dirname: true,
      __filename: true,
    },
    ignoreWarnings: [
      {
        module: /node_modules\/typescript\/lib\/typescript\.js$/,
        message:
          /Critical dependency: the request of a dependency is an expression/,
      },
      {
        module: /node_modules\/@protobufjs\/inquire\/index\.js$/,
        message:
          /Critical dependency: the request of a dependency is an expression/,
      },
    ],
  };
}
