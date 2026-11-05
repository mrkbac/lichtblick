// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Configuration } from "@rspack/core";
import dotenv from "dotenv";
import path from "path";

import { RspackArgv } from "@lichtblick/suite-base/RspackArgv";

import { RspackConfigParams } from "./RspackConfigParams";
import { createCommonWebpackConfig } from "./rspackCommonConfig";

// Load environment variables from .env
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

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
