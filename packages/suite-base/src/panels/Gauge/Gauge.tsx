// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { useCallback, useEffect, useReducer, useState } from "react";

import { Immutable, RenderState, SettingsTreeAction } from "@lichtblick/suite";
import { GlobalVariables } from "@lichtblick/suite-base/hooks/useGlobalVariables";
import { DEFAULT_CONFIG } from "@lichtblick/suite-base/panels/Gauge/constants";
import {
  initialState,
  stateReducer,
} from "@lichtblick/suite-base/panels/shared/gaugeAndIndicatorStateReducer";
import { useReplacePathDrop } from "@lichtblick/suite-base/panels/shared/pathDrop";
import { usePathPanel } from "@lichtblick/suite-base/panels/shared/usePathPanel";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { ArcGauge } from "./ArcGauge";
import { Inclinometer } from "./Inclinometer";
import { Slider } from "./Slider";
import { GaugeConfig, GaugeProps } from "./types";
import { useSettingsTree } from "./useSettingsTree";

/** Restores saved Gauge settings over defaults so older layouts retain their arc display. */
export function Gauge({ context }: GaugeProps): React.JSX.Element {
  const [config, setConfig] = useState(() => ({
    ...DEFAULT_CONFIG,
    ...(context.initialState as Partial<GaugeConfig>),
  }));

  const [state, dispatch] = useReducer(stateReducer, config, initialState);

  // Drop a field from the topic list to show it
  useReplacePathDrop(context, setConfig);

  // The tree has no node actions; every field lives under "general"
  const settingsActionHandler = useCallback((action: SettingsTreeAction) => {
    if (action.action === "update") {
      const { path, value } = action.payload;
      setConfig(produce((draft) => _.set(draft, path.slice(1), value)));
    }
  }, []);

  // Global variables can fill in the path
  const onRender = useCallback((renderState: Immutable<RenderState>) => {
    if (renderState.variables) {
      dispatch({
        type: "updateGlobalVariables",
        globalVariables: Object.fromEntries(renderState.variables) as GlobalVariables,
      });
    }
  }, []);
  useEffect(() => {
    context.watch("variables");
  }, [context]);

  const settingsTree = useSettingsTree({
    config,
    error: state.error?.message,
  });

  const colorScheme = usePathPanel({
    context,
    config,
    dispatch,
    topicName: state.parsedPath?.topicName,
    actionHandler: settingsActionHandler,
    nodes: settingsTree,
    onRender,
  });

  return (
    <ThemeProvider isDark={colorScheme === "dark"}>
      {config.displayMode === "slider" ? (
        <Slider config={config} value={state.latestMatchingQueriedData} />
      ) : config.displayMode === "arc" ? (
        <ArcGauge config={config} value={state.latestMatchingQueriedData} />
      ) : (
        <Inclinometer config={config} value={state.latestMatchingQueriedData} />
      )}
    </ThemeProvider>
  );
}
