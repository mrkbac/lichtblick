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
import { DEFAULT_PLOT_PATH } from "@lichtblick/suite-base/panels/Plot/constants";
import { HandleUpdateAction } from "@lichtblick/suite-base/panels/Plot/types";
import { buildSettingsTree } from "@lichtblick/suite-base/panels/Plot/utils/buildSettingsTree";
import { assignDefaultColorsToSeries, moveItem } from "@lichtblick/suite-base/panels/utils";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { lineColors } from "@lichtblick/suite-base/util/plotColors";

import { PlotConfig, PlotLegendDisplay } from "../utils/config";

export function handleUpdateAction({ draft, path, value }: HandleUpdateAction): void {
  if (path[0] === "paths") {
    if (draft.paths.length === 0) {
      draft.paths.push({ ...DEFAULT_PLOT_PATH });
    }

    if (path[2] === "visible") {
      _.set(draft, [...path.slice(0, 2), "enabled"], value);
    } else {
      _.set(draft, path, value);
    }
  } else if (_.isEqual(path, ["legend", "legendDisplay"])) {
    draft.legendDisplay = value as PlotLegendDisplay;
    draft.showLegend = true;
  } else if (_.isEqual(path, ["xAxis", "xAxisPath"])) {
    _.set(draft, ["xAxisPath", "value"], value);
  } else {
    _.set(draft, path.slice(1), value);

    // X min/max and following width are mutually exclusive.
    if (path[1] === "followingViewWidth") {
      draft.minXValue = undefined;
      draft.maxXValue = undefined;
    } else if (path[1] === "minXValue" || path[1] === "maxXValue") {
      draft.followingViewWidth = undefined;
    }
  }
}

export function handleAddSeriesAction(draft: PlotConfig): void {
  if (draft.paths.length === 0) {
    draft.paths.push({ ...DEFAULT_PLOT_PATH });
  }
  const newIndex = draft.paths.length;
  draft.paths.push({
    ...DEFAULT_PLOT_PATH,
    color: lineColors[newIndex % lineColors.length],
  });
}

/** A horizontal line at 0; the value field takes any number */
export function handleAddReferenceLineAction(draft: PlotConfig): void {
  draft.paths.push({
    ...DEFAULT_PLOT_PATH,
    value: "0",
    color: lineColors[draft.paths.length % lineColors.length],
  });
}

export function handleDeleteSeriesAction(draft: PlotConfig, index: number): void {
  draft.paths.splice(index, 1);
}

export default function usePlotPanelSettings(
  config: PlotConfig,
  saveConfig: SaveConfig<PlotConfig>,
  focusedPath?: readonly string[],
): void {
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const { t } = useTranslation("plot");

  const actionHandler = useCallback(
    ({ action, payload }: SettingsTreeAction) => {
      if (action === "update") {
        const { path, value } = payload;
        saveConfig(
          produce((draft: PlotConfig) => {
            handleUpdateAction({ draft, path, value });
          }),
        );
      } else if (action === "reorder-node") {
        const sourceIndex = Number(payload.path[1]);
        const targetIndex = Number(payload.targetPath[1]);
        saveConfig(
          produce<PlotConfig>((draft) => {
            assignDefaultColorsToSeries(draft.paths);
            moveItem(draft.paths, sourceIndex, targetIndex);
          }),
        );
      } else if (payload.id === "add-series") {
        saveConfig(
          produce<PlotConfig>((draft: PlotConfig) => {
            handleAddSeriesAction(draft);
          }),
        );
      } else if (payload.id === "add-reference-line") {
        saveConfig(
          produce<PlotConfig>((draft: PlotConfig) => {
            handleAddReferenceLineAction(draft);
          }),
        );
      } else if (payload.id === "delete-series") {
        saveConfig(
          produce<PlotConfig>((draft) => {
            handleDeleteSeriesAction(draft, Number(payload.path[1]));
          }),
        );
      }
    },
    [saveConfig],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      focusedPath,
      nodes: buildSettingsTree(config, t),
    });
  }, [actionHandler, config, focusedPath, updatePanelSettingsTree, t]);
}
