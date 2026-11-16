// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { DocumentedNodes } from "@lichtblick/suite-base/panels/shared/documentedSettings";

import Config from "./Config";

export const defaultConfig: Config = {
  selectedNodeId: undefined,
  autoFormatOnSave: true,
};

export function buildSettingsTree(config: Config): DocumentedNodes {
  return {
    general: {
      fields: {
        autoFormatOnSave: {
          input: "boolean",
          label: "Auto-format on save",
          help: "Formats the script with Prettier each time you save it.",
          value: config.autoFormatOnSave,
        },
      },
    },
  };
}
