// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useEffect, useLayoutEffect, useReducer, useState } from "react";

import { parseMessagePath } from "@lichtblick/message-path";
import { SettingsTreeAction } from "@lichtblick/suite";
import { GlobalVariables } from "@lichtblick/suite-base/hooks/useGlobalVariables";
import { DEFAULT_CONFIG } from "@lichtblick/suite-base/panels/Gauge/constants";
import { stateReducer } from "@lichtblick/suite-base/panels/shared/gaugeAndIndicatorStateReducer";
import { useReplacePathDrop } from "@lichtblick/suite-base/panels/shared/pathDrop";
import { GaugeAndIndicatorState } from "@lichtblick/suite-base/panels/shared/types";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { ArcGauge } from "./ArcGauge";
import { Inclinometer } from "./Inclinometer";
import { Slider } from "./Slider";
import { settingsActionReducer } from "./settingsActionReducer";
import { GaugeConfig, GaugeProps } from "./types";
import { useSettingsTree } from "./useSettingsTree";

/** Restores saved Gauge settings over defaults so older layouts retain their arc display. */
export function Gauge({ context }: GaugeProps): React.JSX.Element {
  // panel extensions must notify when they've completed rendering
  // onRender will setRenderDone to a done callback which we can invoke after we've rendered
  const [renderDone, setRenderDone] = useState<() => void>(() => () => {});
  // Follow the app's light/dark theme.
  const [colorScheme, setColorScheme] = useState<"dark" | "light">("dark");

  const [config, setConfig] = useState(() => ({
    ...DEFAULT_CONFIG,
    ...(context.initialState as Partial<GaugeConfig>),
  }));

  const [state, dispatch] = useReducer(
    stateReducer,
    config,
    ({ path }): GaugeAndIndicatorState => ({
      globalVariables: undefined,
      path,
      parsedPath: parseMessagePath(path),
      latestMessage: undefined,
      latestMatchingQueriedData: undefined,
      pathParseError: undefined,
      error: undefined,
    }),
  );

  useLayoutEffect(() => {
    dispatch({ type: "path", path: config.path });
  }, [config.path]);

  useEffect(() => {
    context.saveState(config);
    context.setDefaultPanelTitle(config.path === "" ? undefined : config.path);
  }, [config, context]);

  // Drop a field from the topic list to show it
  useReplacePathDrop(context, setConfig);

  useEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);

      if (renderState.variables) {
        dispatch({
          type: "updateGlobalVariables",
          globalVariables: Object.fromEntries(renderState.variables) as GlobalVariables,
        });
      }

      if (renderState.didSeek === true) {
        dispatch({ type: "seek" });
      }

      if (renderState.currentFrame) {
        dispatch({ type: "frame", messages: renderState.currentFrame });
      }

      if (renderState.colorScheme) {
        setColorScheme(renderState.colorScheme);
      }
    };
    context.watch("currentFrame");
    context.watch("didSeek");
    context.watch("variables");
    context.watch("colorScheme");

    return () => {
      context.onRender = undefined;
    };
  }, [context]);

  const settingsActionHandler = useCallback(
    (action: SettingsTreeAction) => {
      setConfig((prevConfig) => settingsActionReducer({ prevConfig, action }));
    },
    [setConfig],
  );

  const settingsTree = useSettingsTree({
    config,
    pathParseError: state.pathParseError,
    error: state.error?.message,
  });
  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: settingsTree,
    });
  }, [context, settingsActionHandler, settingsTree]);

  useEffect(() => {
    if (state.parsedPath?.topicName != undefined) {
      context.subscribe([{ topic: state.parsedPath.topicName, preload: false }]);
    }
    return () => {
      context.unsubscribeAll();
    };
  }, [context, state.parsedPath?.topicName]);

  // Indicate render is complete - the effect runs after the dom is updated
  useEffect(() => {
    renderDone();
  }, [renderDone]);

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
