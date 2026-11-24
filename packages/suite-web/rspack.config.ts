// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import path from "path";

import { productInfo } from "@lichtblick/suite-base/rspack.ts";

import packageJson from "../../package.json" with { type: "json" };
import { type ConfigParams, mainConfig } from "./src/rspackConfigs.ts";

const params: ConfigParams = {
  // Still web/.webpack because Cloudflare Pages and perf-budget (which builds the base commit)
  // read it there.
  outputPath: path.resolve(import.meta.dirname, "../../web/.webpack"),
  contextPath: path.resolve(import.meta.dirname, "src"),
  entrypoint: "./entrypoint.tsx",
  prodSourceMap: "hidden-source-map",
  product: productInfo(packageJson),
  // Fork-only: show commit + build time in the version string (Settings > About, start dialog).
  version: `${packageJson.version} (${process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? "local"}, built ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC)`,
};

export default mainConfig(params);
