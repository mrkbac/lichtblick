// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { SettingsTreeAction } from "@lichtblick/suite";
import { DEFAULT_STATE_TRANSITION_PATH } from "@lichtblick/suite-base/panels/StateTransitions/constants";
import { buildSettingsTree } from "@lichtblick/suite-base/panels/StateTransitions/settings";
import {
  assignDefaultColorsToSeries,
  handleReorderSeriesAction,
} from "@lichtblick/suite-base/panels/utils";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { PathState, SeriesActionId, StateTransitionConfig } from "../types";

export function usePanelSettings(
  config: StateTransitionConfig,
  saveConfig: SaveConfig<StateTransitionConfig>,
  paths: PathState[],
  focusedPath?: readonly string[],
): void {
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const { t } = useTranslation("stateTransitions");

  const actionHandler = useCallback(
    ({ action, payload }: SettingsTreeAction) => {
      if (action === "reorder-node") {
        const sourceIndex = Number(payload.path[1]);
        const targetIndex = Number(payload.targetPath[1]);
        saveConfig(
          produce<StateTransitionConfig>((draft) => {
            assignDefaultColorsToSeries(draft.paths);
            handleReorderSeriesAction(draft, sourceIndex, targetIndex);
          }),
        );
      } else if (action === "update") {
        const { input, path, value } = payload;

        if (input === "boolean" && _.isEqual(path, ["general", "isSynced"])) {
          saveConfig({ isSynced: value });
        } else if (input === "boolean" && _.isEqual(path, ["general", "showPoints"])) {
          saveConfig({ showPoints: value });
        } else if (path[0] === "xAxis") {
          saveConfig(
            produce((draft: StateTransitionConfig) => {
              _.set(draft, path.slice(1), value);

              // X min/max and range are mutually exclusive.
              if (path[1] === "xAxisRange") {
                draft.xAxisMinValue = undefined;
                draft.xAxisMaxValue = undefined;
              } else if (path[1] === "xAxisMinValue" || path[1] === "xAxisMaxValue") {
                draft.xAxisRange = undefined;
              }
            }),
          );
        } else {
          saveConfig(
            produce((draft: StateTransitionConfig) => {
              if (draft.paths.length === 0) {
                draft.paths.push({ ...DEFAULT_STATE_TRANSITION_PATH });
              }
              _.set(draft, path, value);
            }),
          );
        }
      }

      if (action === "perform-node-action") {
        if (payload.id === SeriesActionId.ADD) {
          saveConfig(
            produce((draft: StateTransitionConfig) => {
              if (draft.paths.length === 0) {
                draft.paths.push({ ...DEFAULT_STATE_TRANSITION_PATH });
              }
              draft.paths.push({ ...DEFAULT_STATE_TRANSITION_PATH });
            }),
          );
        } else if (payload.id === SeriesActionId.DELETE) {
          const index = payload.path[1];
          saveConfig(
            produce((draft) => {
              draft.paths.splice(Number(index), 1);
            }),
          );
        }
      }
    },
    [saveConfig],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      focusedPath,
      nodes: buildSettingsTree(config, paths, t),
    });
  }, [actionHandler, paths, config, focusedPath, t, updatePanelSettingsTree]);
}
