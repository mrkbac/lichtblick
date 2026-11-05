// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { type Configuration, rspack } from "@rspack/core";
import dotenv from "dotenv";
import path from "path";
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin";

import { swcRule, tsCheckerOptions } from "@lichtblick/suite-base/rspack.ts";

import type { RspackConfigParams } from "./RspackConfigParams.ts";

dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });

export function createCommonWebpackConfig(
  params: RspackConfigParams,
  { isDev }: { isDev: boolean },
): Partial<Configuration> {
  return {
    devtool: isDev ? "eval-cheap-module-source-map" : params.prodSourceMap,

    module: {
      rules: [swcRule({ isDev })],
    },

    plugins: [
      new rspack.DefinePlugin({
        // Should match webpack-defines.d.ts
        ReactNull: null,
        LICHTBLICK_PRODUCT_NAME: JSON.stringify(params.packageJson.productName),
        LICHTBLICK_PRODUCT_VERSION: JSON.stringify(params.packageJson.version),
        LICHTBLICK_PRODUCT_HOMEPAGE: JSON.stringify(params.packageJson.homepage),
        LICHTBLICK_SUITE_VERSION: JSON.stringify(params.packageJson.version),
        API_URL: process.env.API_URL ? JSON.stringify(process.env.API_URL) : undefined,
        DEV_WORKSPACE: process.env.DEV_WORKSPACE
          ? JSON.stringify(process.env.DEV_WORKSPACE)
          : undefined,
        OTLP_ENDPOINT: process.env.OTLP_ENDPOINT
          ? JSON.stringify(process.env.OTLP_ENDPOINT)
          : undefined,
      }),
      new TsCheckerRspackPlugin({ typescript: tsCheckerOptions() }),
    ],

    resolve: {
      extensions: [".js", ".ts", ".tsx", ".json"],
    },
  };
}
