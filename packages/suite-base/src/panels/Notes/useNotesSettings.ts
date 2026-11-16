// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SettingsTreeAction } from "@lichtblick/suite";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { buildSettingsTree } from "./settings";
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
      nodes: buildSettingsTree({ fontSize: config.fontSize }, t),
    });
  }, [actionHandler, config.fontSize, t, updatePanelSettingsTree]);
}
