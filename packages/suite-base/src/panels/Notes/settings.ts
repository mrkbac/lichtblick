// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SettingsTreeAction } from "@lichtblick/suite";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { NotesConfig } from "./types";

export function useNotesSettings(config: NotesConfig, saveConfig: SaveConfig<NotesConfig>): void {
  const { t } = useTranslation("notes");
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();

  const actionHandler = useMemo(
    () => (action: SettingsTreeAction) => {
      if (action.action === "update" && action.payload.path[1] === "fontSize") {
        saveConfig({ fontSize: action.payload.value as number | undefined });
      }
    },
    [saveConfig],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: {
        general: {
          label: t("general"),
          fields: {
            fontSize: {
              label: t("fontSize"),
              input: "number",
              min: 8,
              max: 72,
              step: 1,
              placeholder: "auto",
              value: config.fontSize,
            },
          },
        },
      },
    });
  }, [actionHandler, config.fontSize, t, updatePanelSettingsTree]);
}
