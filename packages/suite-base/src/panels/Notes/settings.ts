// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";

import type { DocumentedNodes } from "@lichtblick/suite-base/panels/shared/documentedSettings";

import { NotesConfig } from "./types";

export const defaultConfig: NotesConfig = { text: "" };

export function buildSettingsTree(
  config: Pick<NotesConfig, "fontSize">,
  t: TFunction<"notes">,
): DocumentedNodes {
  return {
    general: {
      label: t("general"),
      fields: {
        fontSize: {
          label: t("fontSize"),
          help: t("fontSizeHelp"),
          input: "number",
          min: 8,
          max: 72,
          step: 1,
          placeholder: "auto",
          value: config.fontSize,
        },
      },
    },
  };
}
