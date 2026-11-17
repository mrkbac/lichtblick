// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect } from "react";

import { SettingsTreeAction } from "@lichtblick/suite";
import { buildSettingsTree } from "@lichtblick/suite-base/panels/RawMessagesCommon/settings";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";

/**
 * Hook to manage font size settings in the panel settings tree.
 * Provides a reusable way to handle font size configuration for Raw Messages panels.
 *
 * @param fontSize - Current font size value (undefined for "auto")
 * @param saveConfig - Function to save the font size configuration
 */
type UseRawMessagesPanelSettingsOptions = {
  fontSize: number | undefined;
  saveConfig: (config: { fontSize?: number }) => void;
};

export function useRawMessagesPanelSettings({
  fontSize,
  saveConfig,
}: UseRawMessagesPanelSettingsOptions): void {
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (
        action.action === "update" &&
        action.payload.path[0] === "general" &&
        action.payload.path[1] === "fontSize"
      ) {
        saveConfig({
          fontSize: typeof action.payload.value === "number" ? action.payload.value : undefined,
        });
      }
    },
    [saveConfig],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: buildSettingsTree(fontSize),
    });
  }, [actionHandler, fontSize, updatePanelSettingsTree]);
}
