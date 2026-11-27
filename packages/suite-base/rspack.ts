// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/// <reference types="node" />

import { type Configuration, type RuleSetRule, rspack } from "@rspack/core";
import fs from "node:fs";
import { createRequire as _nodeCreateRequire } from "node:module";
import path from "node:path";
import { fileURLToPath as _nodeFileURLToPath, pathToFileURL as _nodePathToFileURL } from "node:url";

import type { RspackArgv } from "./RspackArgv.ts";

/**
 * Dev-server overlay filter (`devServer.client.overlay.runtimeErrors`) that hides known false
 * positives.
 *
 * When a webworker is terminated, any pending `importScripts` calls are cancelled by the browser
 * and bubble up to the page's `window.onerror`, which the dev server overlay listens to. The worker
 * is gone, so these are noise. A legitimately failing `importScripts` still breaks the worker logic
 * that depends on it, and the error stays visible in the devtools console.
 */
export function isOverlayRuntimeError(error: Error): boolean {
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
}

/**
 * Per-message decoders whose published `dist` targets ES2020, which turns every `#private` field
 * access into a WeakMap helper call. They ship their TypeScript `src/`, so we compile that with our
 * ES2022 target instead (~17% faster ROS 2 decoding). Values: the workspace package that depends on
 * each, since pnpm only links a dependency into its dependents.
 */
const DECODERS_FROM_SRC: Record<string, string> = {
  "@foxglove/rosmsg2-serialization": "suite-base",
  "@foxglove/omgidl-serialization": "mcap-support",
};
const DECODER_SRC_DIRS = /[\\/]@foxglove[\\/](rosmsg2|omgidl)-serialization[\\/]src[\\/]/;

/** Aliases each decoder to its `src/index.ts`; fails the build if a package stops shipping it. */
function decoderSrcAliases(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(DECODERS_FROM_SRC).map(([name, dependent]) => {
      const dependentRequire = _nodeCreateRequire(
        path.join(import.meta.dirname, "..", dependent, "package.json"),
      );
      const pkgDir = path.dirname(dependentRequire.resolve(`${name}/package.json`));
      const entry = path.join(pkgDir, "src", "index.ts");
      if (!fs.existsSync(entry) || !DECODER_SRC_DIRS.test(entry)) {
        throw new Error(`${name} no longer ships src/index.ts; update DECODERS_FROM_SRC`);
      }
      return [`${name}$`, entry];
    }),
  );
}

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
    // node_modules ships JS, except the decoders compiled from src (see DECODERS_FROM_SRC)
    exclude: { and: [/node_modules/, { not: DECODER_SRC_DIRS }] },
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

const dirHref = _nodePathToFileURL(import.meta.dirname + "/").href;
const localRequire = _nodeCreateRequire(import.meta.dirname + "/package.json");

// Load .env on import, before any config factory runs (Node's built-in loader; existing env vars win)
const envFile = path.resolve(import.meta.dirname, "../../.env");
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/** What the UI shows about the product; one place to rebrand (root package.json). */
export type ProductInfo = {
  name: string;
  /** Documentation site, used for every docs link */
  homepage: string;
  /** Web URL of the source repository (releases, license, source links) */
  repositoryUrl: string;
};

export function productInfo(packageJson: {
  productName: string;
  homepage: string;
  repository: { url: string };
}): ProductInfo {
  return {
    name: packageJson.productName,
    // Ends with "/" so docs paths can be appended directly
    homepage: packageJson.homepage.replace(/\/?$/, "/"),
    repositoryUrl: packageJson.repository.url.replace(/^git\+/, "").replace(/\.git$/, ""),
  };
}

type Options = {
  /** Specify the app version. */
  version: string;
  product: ProductInfo;
};

// Create a partial webpack configuration required to build app using webpack.
// Returns a webpack configuration containing resolve, module, plugins, and node fields.
export function makeConfig(
  _: unknown,
  argv: RspackArgv,
  options: Options,
): Pick<
  Configuration,
  "resolve" | "module" | "plugins" | "node" | "ignoreWarnings" | "optimization"
> {
  const isDev = argv.mode === "development";
  const isServe = argv.env?.RSPACK_SERVE ?? false;

  const { version, product } = options;

  return {
    resolve: {
      extensions: [".js", ".ts", ".jsx", ".tsx"],
      alias: {
        ...decoderSrcAliases(),
        "@lichtblick/suite-base": _nodeFileURLToPath(new URL("src", dirHref)),
        // Code without its own react dependency (pnpm doesn't hoist it) resolves the JSX runtime
        // from suite-base.
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
      // Node built-ins imported by dependencies
      fallback: {
        // xmlbuilder2 subclasses EventEmitter at load
        events: localRequire.resolve("events"),
        // Only reached by Node-only code paths (sql.js, sax, TypeScript, wasm decoders)
        path: false,
        stream: false,
        crypto: false,
        fs: false,
        module: false,
        perf_hooks: false,
      },
    },
    module: {
      rules: [
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
          options: { sourceMap: isDev },
        },
        // Separate files, not inlined: base64 fonts inflated the entry chunk by ~0.9 MB.
        { test: /\.woff2?$/, type: "asset/resource" },
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
        LICHTBLICK_PRODUCT_NAME: JSON.stringify(product.name),
        LICHTBLICK_REPOSITORY_URL: JSON.stringify(product.repositoryUrl),
        // licht deploys talk to its organization server unless API_URL says otherwise.
        API_URL: JSON.stringify(process.env.API_URL ?? "https://licht-server.marko.im"),
      }),
    ],
    optimization: {
      splitChunks: {
        // Lazy chunks only (the default "async"), except workers named "*-worker"
        // (webpackChunkName): a worker loads its split chunks one by one with blocking
        // importScripts, each a request (a round trip on a first visit), and the MCAP source
        // worker needed ~20 before it could open a file. Such a worker stays one file, at the cost
        // of its own copy of the code it shares; its lazy imports are still separate chunks.
        chunks: (chunk) => !chunk.canBeInitial() && chunk.name?.endsWith("-worker") !== true,
      },
    },
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
