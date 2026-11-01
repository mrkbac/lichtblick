// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Slider, Typography } from "@mui/material";
import * as _ from "lodash-es";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DeepPartial } from "ts-essentials";

import { ros1, ros2humble } from "@lichtblick/rosmsg-msgs-common";
import { SettingsTreeAction, Topic } from "@lichtblick/suite";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import Stack from "@lichtblick/suite-base/components/Stack";
import DirectionalPad from "@lichtblick/suite-base/panels/Teleop/DirectionalPad";
import Joystick from "@lichtblick/suite-base/panels/Teleop/Joystick";
import { buildSettingsTreeTeleop } from "@lichtblick/suite-base/panels/Teleop/buildSettingsTree";
import { DEFAULT_CONFIG } from "@lichtblick/suite-base/panels/Teleop/constants";
import {
  actionToVector,
  applyDeadzone,
  computeTwist,
  isActive,
  ZERO_VECTOR,
} from "@lichtblick/suite-base/panels/Teleop/twist";
import {
  TeleopConfig,
  DirectionalPadAction,
  TeleopPanelProps,
  TeleopVector,
} from "@lichtblick/suite-base/panels/Teleop/types";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

const KEY_ACTIONS: Record<string, DirectionalPadAction> = {
  w: DirectionalPadAction.UP,
  arrowup: DirectionalPadAction.UP,
  s: DirectionalPadAction.DOWN,
  arrowdown: DirectionalPadAction.DOWN,
  a: DirectionalPadAction.LEFT,
  arrowleft: DirectionalPadAction.LEFT,
  d: DirectionalPadAction.RIGHT,
  arrowright: DirectionalPadAction.RIGHT,
};

type InputSources = {
  /** On-screen joystick / d-pad, held with mouse or touch */
  pointer?: TeleopVector;
  keys: Set<DirectionalPadAction>;
  gamepad?: TeleopVector;
};

function keysToVector(keys: ReadonlySet<DirectionalPadAction>): TeleopVector {
  let x = 0;
  let y = 0;
  for (const key of keys) {
    const vector = actionToVector(key);
    x += vector.x;
    y += vector.y;
  }
  return { x, y };
}

function formatTwist(config: TeleopConfig, vector: TeleopVector): string {
  const twist = computeTwist(config, vector);
  const parts = (["linear", "angular"] as const).flatMap((kind) =>
    (["x", "y", "z"] as const)
      .filter((axis) => twist[kind][axis] !== 0)
      .map((axis) => `${kind}.${axis} ${twist[kind][axis].toFixed(2)}`),
  );
  return parts.length > 0 ? parts.join("  ") : "Stopped";
}

function TeleopPanel(props: Readonly<TeleopPanelProps>): React.JSX.Element {
  const { context } = props;
  const { saveState } = context;

  const [topics, setTopics] = useState<readonly Topic[]>([]);

  // resolve an initial config which may have some missing fields into a full config
  const [config, setConfig] = useState<TeleopConfig>(() =>
    _.merge(
      _.cloneDeep(DEFAULT_CONFIG),
      context.initialState as DeepPartial<TeleopConfig> | undefined,
    ),
  );

  const settingsActionHandler = useCallback((action: SettingsTreeAction) => {
    if (action.action !== "update") {
      return;
    }

    setConfig((previous) => {
      const newConfig = { ...previous };
      _.set(newConfig, action.payload.path.slice(1), action.payload.value);
      return newConfig;
    });
  }, []);

  // setup context render handler and render done handling
  const [renderDone, setRenderDone] = useState<() => void>(() => () => {});
  const [colorScheme, setColorScheme] = useState<"dark" | "light">("light");
  useLayoutEffect(() => {
    context.watch("topics");
    context.watch("colorScheme");

    context.onRender = (renderState, done) => {
      setTopics(renderState.topics ?? []);
      setRenderDone(() => done);
      if (renderState.colorScheme) {
        setColorScheme(renderState.colorScheme);
      }
    };
  }, [context]);

  useEffect(() => {
    const tree = buildSettingsTreeTeleop(config, topics);
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: tree,
    });
    saveState(config);
  }, [config, context, saveState, settingsActionHandler, topics]);

  const { topic: currentTopic } = config;
  useEffect(() => {
    context.setDefaultPanelTitle(currentTopic ? `Teleop ${currentTopic}` : undefined);
  }, [context, currentTopic]);

  const canPublish = context.publish != undefined && config.publishRate > 0;
  const hasTopic = Boolean(currentTopic);
  const enabled = canPublish && hasTopic;

  // Input handlers and timers read the latest values through this ref so they don't need to be
  // re-registered on every config change.
  const latest = useRef({ config, enabled });
  useLayoutEffect(() => {
    latest.current = { config, enabled };
  }, [config, enabled]);

  const publishVector = useCallback(
    (vector: TeleopVector) => {
      const { config: cfg, enabled: canSend } = latest.current;
      if (!canSend || !cfg.topic) {
        return;
      }
      const twist = computeTwist(cfg, vector);
      const now = Date.now();
      // ponytail: wall-clock stamp; robots running on sim time (/clock) may reject it
      const message =
        cfg.messageType === "TwistStamped"
          ? {
              header: {
                stamp: { sec: Math.floor(now / 1000), nsec: (now % 1000) * 1e6 },
                frame_id: cfg.frameId,
              },
              twist,
            }
          : twist;
      try {
        context.publish?.(cfg.topic, message);
      } catch (error) {
        console.error("Failed to publish message:", error);
      }
    },
    [context],
  );

  const sources = useRef<InputSources>({ keys: new Set<DirectionalPadAction>() });
  const vectorRef = useRef<TeleopVector>(ZERO_VECTOR);
  const [vector, setVector] = useState<TeleopVector>(ZERO_VECTOR);

  // Combine the input sources (pointer wins over keyboard, keyboard over gamepad) and publish
  // immediately on start and stop instead of waiting for the next tick.
  const updateVector = useCallback(() => {
    const { pointer, keys, gamepad } = sources.current;
    const next = pointer ?? (keys.size > 0 ? keysToVector(keys) : (gamepad ?? ZERO_VECTOR));
    const prev = vectorRef.current;
    if (prev.x === next.x && prev.y === next.y) {
      return;
    }
    vectorRef.current = next;
    setVector(next);
    if (isActive(next) && !isActive(prev)) {
      publishVector(next);
    } else if (!isActive(next) && isActive(prev) && latest.current.config.stopOnRelease) {
      publishVector(ZERO_VECTOR);
    }
  }, [publishVector]);

  // bumping this remounts the joystick, dropping its drag and pointer capture so a held mouse
  // can't resume driving after a stop
  const [releaseCount, setReleaseCount] = useState(0);
  const releaseAll = useCallback(() => {
    sources.current = { keys: new Set<DirectionalPadAction>() };
    setReleaseCount((count) => count + 1);
    updateVector();
  }, [updateVector]);

  const emergencyStop = useCallback(() => {
    releaseAll();
    publishVector(ZERO_VECTOR);
  }, [publishVector, releaseAll]);

  // advertise topic
  const { messageType } = config;
  const isInitialMount = useRef(true);
  useLayoutEffect(() => {
    if (!currentTopic) {
      return;
    }

    const isRos2 = context.dataSourceProfile === "ros2";
    const datatypes = isRos2 ? ros2humble : ros1;
    const rootType = `geometry_msgs/${messageType}` as const;
    // ROS 2 schema names include "/msg/"; the definition maps use the short names
    const schemaName = isRos2 ? `geometry_msgs/msg/${messageType}` : rootType;
    context.advertise?.(currentTopic, schemaName, {
      datatypes: new Map([
        ...[
          "geometry_msgs/Vector3",
          "geometry_msgs/Twist",
          "geometry_msgs/TwistStamped",
          "std_msgs/Header",
        ].map((name) => [name, datatypes[name as keyof typeof datatypes]] as const),
        [schemaName, datatypes[rootType]],
      ]),
    });

    return () => {
      // never leave the robot driving on a topic we stop publishing to
      if (isActive(vectorRef.current)) {
        publishVector(ZERO_VECTOR);
      }
      if (!isInitialMount.current) {
        context.unadvertise?.(currentTopic);
      }
      isInitialMount.current = false;
    };
  }, [context, currentTopic, messageType, publishVector]);

  // keep publishing while a command is held so the robot's command timeout doesn't trip
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const intervalHandle = setInterval(() => {
      if (isActive(vectorRef.current)) {
        publishVector(vectorRef.current);
      }
    }, 1000 / config.publishRate);
    return () => {
      clearInterval(intervalHandle);
    };
  }, [enabled, config.publishRate, publishVector]);

  // key-up and pointer-up events get lost when the window loses focus, so stop instead of driving
  // on with a stuck input
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        releaseAll();
      }
    };
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [releaseAll]);

  const [gamepadName, setGamepadName] = useState<string | undefined>();
  const { gamepad: gamepadEnabled, gamepadDeadzone } = config;
  useEffect(() => {
    if (!gamepadEnabled || typeof navigator.getGamepads !== "function") {
      return;
    }
    let frame = 0;
    const poll = () => {
      const pad = navigator.getGamepads().find((candidate) => candidate?.connected === true);
      setGamepadName(pad?.id);
      // left stick, like teleop_twist_joy; browser y axis points down
      const next =
        pad && document.hasFocus()
          ? applyDeadzone(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0), gamepadDeadzone)
          : ZERO_VECTOR;
      const prev = sources.current.gamepad ?? ZERO_VECTOR;
      if (next.x !== prev.x || next.y !== prev.y) {
        sources.current.gamepad = isActive(next) ? next : undefined;
        updateVector();
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(frame);
      sources.current.gamepad = undefined;
      setGamepadName(undefined);
      updateVector();
    };
  }, [gamepadEnabled, gamepadDeadzone, updateVector]);

  const setPointer = useCallback(
    (next?: TeleopVector) => {
      sources.current.pointer = next;
      updateVector();
    },
    [updateVector],
  );

  const onDirectionalPadAction = useCallback(
    (action?: DirectionalPadAction) => {
      setPointer(action == undefined ? undefined : actionToVector(action));
    },
    [setPointer],
  );

  const setSpeedScale = useCallback((speedScale: number) => {
    setConfig((previous) => ({
      ...previous,
      speedScale: _.clamp(Math.round(speedScale * 100) / 100, 0.05, 1),
    }));
  }, []);

  const [focused, setFocused] = useState(false);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (
      !config.keyboard ||
      event.target !== event.currentTarget ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === " " || key === "escape") {
      event.preventDefault();
      emergencyStop();
      return;
    }
    if (key === "+" || key === "=" || key === "-") {
      setSpeedScale(config.speedScale + (key === "-" ? -0.1 : 0.1));
      return;
    }
    const action = KEY_ACTIONS[key];
    if (action == undefined) {
      return;
    }
    event.preventDefault();
    sources.current.keys.add(action);
    updateVector();
  };

  const onKeyUp = (event: React.KeyboardEvent) => {
    const action = KEY_ACTIONS[event.key.toLowerCase()];
    if (action != undefined && sources.current.keys.delete(action)) {
      updateVector();
    }
  };

  useLayoutEffect(() => {
    renderDone();
  }, [renderDone]);

  const hints = [
    config.keyboard &&
      (focused ? "WASD / arrows · Space stop · +/− speed" : "Click panel for keyboard control"),
    gamepadName && `Gamepad: ${gamepadName}`,
  ].filter(Boolean);

  return (
    <ThemeProvider isDark={colorScheme === "dark"}>
      <div
        style={{ height: "100%", outline: "none" }}
        tabIndex={enabled ? 0 : undefined}
        onKeyDown={enabled ? onKeyDown : undefined}
        onKeyUp={enabled ? onKeyUp : undefined}
        // only the panel itself takes drive keys, so the speed slider keeps its own arrow keys
        onFocus={(event) => {
          setFocused(event.target === event.currentTarget);
        }}
        onBlur={(event) => {
          if (event.target === event.currentTarget) {
            setFocused(false);
            releaseAll();
          }
        }}
      >
        <Stack
          fullHeight
          justifyContent="center"
          alignItems="center"
          gap={0.5}
          style={{ padding: "min(5%, 8px)", textAlign: "center" }}
        >
          {!canPublish && (
            <EmptyState>Connect to a data source that supports publishing</EmptyState>
          )}
          {canPublish && !hasTopic && (
            <EmptyState>Select a publish topic in the panel settings</EmptyState>
          )}
          {enabled && (
            <>
              <Stack direction="row" alignItems="center" gap={1.5} fullWidth paddingX={1}>
                <Typography variant="caption" color="text.secondary" noWrap flexShrink={0}>
                  Speed {Math.round(config.speedScale * 100)}%
                </Typography>
                <Slider
                  size="small"
                  aria-label="Speed"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={config.speedScale}
                  onChange={(_event, value) => {
                    setSpeedScale(value);
                  }}
                />
              </Stack>
              <Stack
                flex="auto"
                fullWidth
                justifyContent="center"
                alignItems="center"
                overflow="hidden"
              >
                {config.mode === "dpad" ? (
                  <DirectionalPad onAction={onDirectionalPadAction} vector={vector} />
                ) : (
                  <Joystick key={releaseCount} vector={vector} onChange={setPointer} />
                )}
              </Stack>
              <Typography
                variant="caption"
                fontFamily="monospace"
                color={isActive(vector) ? "primary" : "text.secondary"}
                noWrap
              >
                {formatTwist(config, vector)}
              </Typography>
              {hints.length > 0 && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {hints.join(" · ")}
                </Typography>
              )}
            </>
          )}
        </Stack>
      </div>
    </ThemeProvider>
  );
}

export default TeleopPanel;
