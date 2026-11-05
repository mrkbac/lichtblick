// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { mergeRsbuildConfig } from "@rsbuild/core";
import { StorybookConfig } from "storybook-react-rsbuild";

import { makeConfig } from "../packages/suite-base/rspack.ts";

const storybookConfig: StorybookConfig = {
  // Workaround for https://github.com/storybookjs/storybook/issues/19446
  stories: ["../packages/**/!(node_modules)**/*.stories.tsx"],
  framework: {
    name: "storybook-react-rsbuild",
    options: {},
  },
  // Prop tables aren't used and docgen slows the build down
  typescript: { reactDocgen: false },
  // Our app config already handles every import and edge case we need, so its module rules
  // replace the framework defaults. Storybook's own plugins (e.g. the iframe HTML) are kept.
  rsbuildFinal: (config) =>
    mergeRsbuildConfig(config, {
      tools: {
        rspack: (rspackConfig) => {
          const studioConfig = makeConfig(
            undefined,
            { mode: rspackConfig.mode },
            {
              allowUnusedVariables: true,
              version: "0.0.0-storybook",
              tsconfigPath: new URL("tsconfig.json", import.meta.url).pathname,
              // Required in ESM context (Storybook) where __dirname is not available in webpack.ts.
              packageDir: new URL("../packages/suite-base", import.meta.url).pathname,
            },
          );
          return {
            ...rspackConfig,
            optimization: { ...rspackConfig.optimization, minimize: false },
            resolve: {
              ...studioConfig.resolve,
              fallback: { ...studioConfig.resolve?.fallback, ...rspackConfig.resolve?.fallback },
            },
            module: studioConfig.module,
            plugins: [...(rspackConfig.plugins ?? []), ...(studioConfig.plugins ?? [])],
            node: studioConfig.node,
            ignoreWarnings: studioConfig.ignoreWarnings,
          };
        },
      },
    }),
};

export default storybookConfig;
