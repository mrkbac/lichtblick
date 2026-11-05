// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Configuration } from "@rspack/core";
import path from "node:path";

import { resolveConfigs, type RspackArgv } from "@lichtblick/suite-base/RspackArgv.ts";
import type { RspackConfigParams } from "@lichtblick/suite-desktop/src/RspackConfigParams.ts";
import { rspackMainConfig } from "@lichtblick/suite-desktop/src/rspackMainConfig.ts";
import { rspackPreloadConfig } from "@lichtblick/suite-desktop/src/rspackPreloadConfig.ts";
import { rspackQuicklookConfig } from "@lichtblick/suite-desktop/src/rspackQuicklookConfig.ts";
import { rspackRendererConfig } from "@lichtblick/suite-desktop/src/rspackRendererConfig.ts";
import { rspackRootConfig } from "@lichtblick/suite-desktop/src/rspackRootConfig.ts";

import packageJson from "../package.json" with { type: "json" };

const params: RspackConfigParams = {
  packageJson,
  outputPath: path.resolve(import.meta.dirname, ".webpack"),
  prodSourceMap: "source-map",
  rendererContext: path.resolve(import.meta.dirname, "renderer"),
  rendererEntrypoint: "./index.tsx",
  mainContext: path.resolve(import.meta.dirname, "main"),
  mainEntrypoint: "./index.ts",
  quicklookContext: path.resolve(import.meta.dirname, "quicklook"),
  quicklookEntrypoint: "./index.ts",
  preloadContext: path.resolve(import.meta.dirname, "preload"),
  preloadEntrypoint: "./index.ts",
};

export default (env: unknown, argv: RspackArgv): Configuration[] =>
  resolveConfigs(env, argv, [
    rspackRootConfig(params),
    rspackMainConfig(params),
    rspackPreloadConfig(params),
    rspackRendererConfig(params),
    rspackQuicklookConfig(params),
  ]);
