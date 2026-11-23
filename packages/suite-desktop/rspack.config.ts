// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Configuration } from "@rspack/core";
import path from "node:path";

import { resolveConfigs, type RspackArgv } from "@lichtblick/suite-base/RspackArgv.ts";

import packageJson from "../../package.json" with { type: "json" };
import type { RspackConfigParams } from "./src/RspackConfigParams.ts";
import { rspackMainConfig } from "./src/rspackMainConfig.ts";
import { rspackPreloadConfig } from "./src/rspackPreloadConfig.ts";
import { rspackRendererConfig } from "./src/rspackRendererConfig.ts";
import { rspackRootConfig } from "./src/rspackRootConfig.ts";

const params: RspackConfigParams = {
  packageJson,
  outputPath: path.resolve(import.meta.dirname, ".webpack"),
  // Maps stay next to the build for debugging; electronBuilderConfig.js keeps them out of the app
  prodSourceMap: "hidden-source-map",
  rendererContext: path.resolve(import.meta.dirname, "src/entry"),
  rendererEntrypoint: "./renderer.tsx",
  mainContext: path.resolve(import.meta.dirname, "src/entry"),
  mainEntrypoint: "./main.ts",
  preloadContext: path.resolve(import.meta.dirname, "src/entry"),
  preloadEntrypoint: "./preload.ts",
};

export default (env: unknown, argv: RspackArgv): Configuration[] =>
  resolveConfigs(env, argv, [
    rspackRootConfig(params),
    rspackMainConfig(params),
    rspackPreloadConfig(params),
    rspackRendererConfig(params),
  ]);
