// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Configuration, RuleSetRule, rspack } from "@rspack/core";
import dotenv from "dotenv";
import MonacoWebpackPlugin from "monaco-editor-webpack-plugin";
import { createRequire as _nodeCreateRequire } from "node:module";
import { fileURLToPath as _nodeFileURLToPath, pathToFileURL as _nodePathToFileURL } from "node:url";
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin";

import { RspackArgv } from "./RspackArgv";

/**
 * Type checking runs on the native TypeScript 7 compiler (installed as "typescript7"); tooling
 * that needs the compiler API (ts-node, the user script transformer) stays on the "typescript" 6 package.
 */
export function tsCheckerOptions(): { tsgo: true; typescriptPath: string } {
  // Builds run from the repo root, where typescript7 is installed (works in ESM and CJS)
  const rootRequire = _nodeCreateRequire(`${process.cwd()}/package.json`);
  return { tsgo: true, typescriptPath: rootRequire.resolve("typescript7/package.json") };
}

/**
 * Transpiles TypeScript/TSX with Rspack's built-in SWC loader (type checking runs separately in
 * TsCheckerRspackPlugin). `refresh` enables React Fast Refresh for the dev server.
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
  // During hot reloading and development it is useful to comment out code while iterating.
  // We ignore errors from unused locals to avoid having to also comment
  // those out while iterating.
  allowUnusedVariables?: boolean;
  /** Specify the app version. */
  version: string;
  /** Specify the path to the tsconfig.json file for ForkTsCheckerWebpackPlugin. If unset, the plugin defaults to finding the config file in the webpack `context` directory. */
  tsconfigPath?: string;
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
): Pick<Configuration, "resolve" | "module" | "plugins" | "node" | "ignoreWarnings"> {
  initModuleLocals(options.packageDir);
  // After initModuleLocals, currentDirHref and localRequireInstance are guaranteed to be set.
  const dirHref = currentDirHref!;
  const localRequire = localRequireInstance!;

  const isDev = argv.mode === "development";
  const isServe = argv.env?.RSPACK_SERVE ?? false;

  const { allowUnusedVariables = isDev && isServe, version, tsconfigPath } = options;

  return {
    resolve: {
      extensions: [".js", ".ts", ".jsx", ".tsx"],
      alias: {
        "@lichtblick/suite-base": _nodeFileURLToPath(new URL("src", dirHref)),
      },
      fallback: {
        path: localRequire.resolve("path-browserify"),
        stream: localRequire.resolve("readable-stream"),
        url: _nodeFileURLToPath(new URL("src/util/shims/url.ts", dirHref)),
        assert: false,
        zlib: false,
        // Only reached by Node-only code paths (sql.js); the polyfill pulled in ~1 MiB.
        crypto: false,
        vm: false,

        // TypeScript tries to use this when running in node
        perf_hooks: false,
        // Yarn patches these imports into TypeScript for PnP support
        // https://github.com/microsoft/TypeScript/pull/35206
        // https://github.com/yarnpkg/berry/pull/2889#issuecomment-849905154
        module: false,

        domain: false,

        // don't inject these things into our web build
        fs: false,
        pnpapi: false,

        // punycode is a dependency for some older webpack v4 browser libs
        // It adds unecessary bloat to the build so we make sure it isn't included
        punycode: false,
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
        { ...swcRule({ isDev, refresh: isServe }), resourceQuery: { not: [/raw/] } },
        // Name tss-react classes after their file in dev builds
        ...(isDev
          ? [
              {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                resourceQuery: { not: [/raw/] },
                loader: _nodeFileURLToPath(new URL("loaders/tssReactNameLoader.cjs", dirHref)),
              },
            ]
          : []),
        {
          // "?raw" imports are used to load the original un-modified source
          // https://webpack.js.org/guides/asset-modules/#replacing-inline-loader-syntax
          resourceQuery: /raw/,
          type: "asset/source",
        },
        { test: /\.(md|template)$/, type: "asset/source" },
        {
          test: /\.svg$/,
          loader: "@svgr/webpack",
          options: {
            svgo: {
              plugins: [{ removeViewBox: false }, { removeDimensions: false }],
            },
          },
        },
        { test: /\.ne$/, loader: "nearley-loader" },
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
          loader: "style-loader",
          sideEffects: true,
        },
        {
          test: /\.css$/,
          loader: "css-loader",
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
          loader: "string-replace-loader",
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
        API_URL: JSON.stringify(process.env.API_URL ?? "https://licht-server.marko.im"),
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
      new TsCheckerRspackPlugin({
        typescript: {
          ...tsCheckerOptions(),
          configFile: tsconfigPath,
          configOverwrite: {
            compilerOptions: {
              noUnusedLocals: !allowUnusedVariables,
              noUnusedParameters: !allowUnusedVariables,
              jsx: isDev ? "react-jsxdev" : "react-jsx",
            },
          },
        },
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
