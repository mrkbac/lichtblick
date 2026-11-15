// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Configuration } from "@rspack/core";
import fs from "fs";
import path from "path";

import type { RspackArgv } from "@lichtblick/suite-base/RspackArgv.ts";

import type { RspackConfigParams } from "./RspackConfigParams.ts";
import { createCommonWebpackConfig } from "./rspackCommonConfig.ts";

// Load environment variables from .env
// Load .env if present (Node's built-in loader; existing env vars win)
if (fs.existsSync(path.resolve(import.meta.dirname, "../../../.env"))) {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
}

export const rspackPreloadConfig =
  (params: RspackConfigParams) =>
  (_: unknown, argv: RspackArgv): Configuration => {
    const isDev = argv.mode === "development";
    const commonConfig = createCommonWebpackConfig(params, { isDev });

    return {
      ...commonConfig,
      name: "preload",
      dependencies: ["root"],
      context: params.preloadContext,
      entry: params.preloadEntrypoint,
      target: "electron-preload",
      output: {
        publicPath: "",
        filename: "preload.js",
        path: path.join(params.outputPath, "main"),
      },
    };
  };
