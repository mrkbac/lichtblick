// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useLayoutEffect, useState } from "react";

import { Immutable, RenderState, SettingsTree } from "@lichtblick/suite";
import { BuiltinPanelExtensionContext } from "@lichtblick/suite-base/components/PanelExtensionAdapter";

import { FrameAction, PathAction, SeekAction } from "./types";

/**
 * Lifecycle shared by the single-path panels (Gauge, Indicator, Pie chart): saved state and title,
 * path/seek/frame dispatch, subscription, settings editor and render-done. Returns the app's color
 * scheme. `onRender` runs first on every render for panel-specific render state; keep it stable.
 */
export function usePathPanel({
  context,
  config,
  dispatch,
  topicName,
  actionHandler,
  nodes,
  onRender,
}: {
  context: BuiltinPanelExtensionContext;
  config: { path: string };
  dispatch: (action: FrameAction | PathAction | SeekAction) => void;
  topicName: string | undefined;
  actionHandler: SettingsTree["actionHandler"];
  nodes: Immutable<SettingsTree>["nodes"];
  onRender?: (renderState: Immutable<RenderState>) => void;
}): "dark" | "light" {
  // panel extensions must notify when they've completed rendering
  // onRender will setRenderDone to a done callback which we can invoke after we've rendered
  const [renderDone, setRenderDone] = useState<() => void>(() => () => {});
  // Follow the app's light/dark theme.
  const [colorScheme, setColorScheme] = useState<"dark" | "light">("dark");

  useLayoutEffect(() => {
    dispatch({ type: "path", path: config.path });
  }, [config.path, dispatch]);

  useEffect(() => {
    context.saveState(config);
    context.setDefaultPanelTitle(config.path === "" ? undefined : config.path);
  }, [config, context]);

  useEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);

      onRender?.(renderState);

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
    context.watch("colorScheme");

    return () => {
      context.onRender = undefined;
    };
  }, [context, dispatch, onRender]);

  useEffect(() => {
    context.updatePanelSettingsEditor({ actionHandler, nodes });
  }, [context, actionHandler, nodes]);

  useEffect(() => {
    if (topicName != undefined) {
      context.subscribe([{ topic: topicName, preload: false }]);
    }
    return () => {
      context.unsubscribeAll();
    };
  }, [context, topicName]);

  // Indicate render is complete - the effect runs after the dom is updated
  useEffect(() => {
    renderDone();
  }, [renderDone]);

  return colorScheme;
}
