// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Bundles the perf budget cases (src/perf/cases.ts) for Node the way the app ships: the app's
// loaders, aliases and ES2022 SWC target, production mode. Run by ci/perf-budget.ts.

import type { Configuration } from "@rspack/core";
import path from "node:path";
import { pathToFileURL } from "node:url";

import packageJson from "../package.json" with { type: "json" };
import type { RspackArgv } from "../packages/suite-base/RspackArgv.ts";
import { makeConfig, productInfo } from "../packages/suite-base/rspack.ts";

export default (env: unknown, argv: RspackArgv): Configuration => {
  const appConfig = makeConfig(env, argv, {
    version: "0.0.0-perf",
    product: productInfo(packageJson),
  });
  const outputPath = path.resolve(import.meta.dirname, ".perf");
  return {
    ...appConfig,
    // Node built-ins stay real; the browser fallbacks would stub them out
    resolve: { ...appConfig.resolve, fallback: {} },
    target: "node",
    context: path.resolve(import.meta.dirname, "src/perf"),
    entry: { cases: "./cases.ts" },
    devtool: false,
    output: {
      path: outputPath,
      // WASM is fetched by URL; Node has no page URL to resolve a relative one against
      publicPath: pathToFileURL(outputPath).href + "/",
      filename: "[name].mjs",
      chunkFormat: "module",
      library: { type: "module" },
      clean: true,
    },
  };
};
