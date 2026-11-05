// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { type Configuration, rspack } from "@rspack/core";
import path from "path";

import type { RspackArgv } from "@lichtblick/suite-base/RspackArgv.ts";

import type { RspackConfigParams } from "./RspackConfigParams.ts";

/**
 * Cleans the output directory and writes the `package.json` Electron reads to find its main entry.
 * The dev server itself is configured on the renderer config.
 */
export const rspackRootConfig =
  (params: RspackConfigParams) =>
  (_: unknown, argv: RspackArgv): Configuration => {
    const isRelease = argv.mode === "production";

    // The appdata directory is derived from the product name. To have a separate directory
    // for our production and development builds we change the product name when using dev or serve.
    const productName = isRelease
      ? params.packageJson.productName
      : `${params.packageJson.productName} Dev`;

    return {
      name: "root",
      // Use empty entry to avoid the default fallback to /src
      entry: {},

      output: {
        publicPath: "",
        path: params.outputPath,
        clean: true,
      },

      plugins: [
        // Electron (and electron-builder) read package.json to find the entry script
        new rspack.CopyRspackPlugin({
          patterns: [
            {
              from: path.resolve(import.meta.dirname, "../../../package.json"),
              transform: () =>
                JSON.stringify({
                  main: "main/main.js",
                  name: params.packageJson.name,
                  productName,
                  version: params.packageJson.version,
                  description: params.packageJson.description,
                  productDescription: params.packageJson.productDescription,
                  license: params.packageJson.license,
                  author: params.packageJson.author,
                }) ?? "",
            },
          ],
        }),
      ],
    };
  };
