// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { MessageDefinition } from "@foxglove/message-definition";
import { ros1 } from "@foxglove/rosmsg-msgs-common";
import { Button, Slider, Typography } from "@mui/material";
import * as _ from "lodash-es";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { SettingsTreeAction, Topic } from "@lichtblick/suite";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import Stack from "@lichtblick/suite-base/components/Stack";
import DirectionalPad from "@lichtblick/suite-base/panels/Teleop/DirectionalPad";
import FaceButtons from "@lichtblick/suite-base/panels/Teleop/FaceButtons";
import Joystick from "@lichtblick/suite-base/panels/Teleop/Joystick";
import {
  applySettingsAction,
  buildSettingsTreeTeleop,
} from "@lichtblick/suite-base/panels/Teleop/buildSettingsTree";
import { BUTTON_LABELS } from "@lichtblick/suite-base/panels/Teleop/constants";
import {
  actionToVector,
  combinePads,
  computeTwist,
  hasButton,
  isActive,
  isNeutral,
  isZeroTwist,
  keysToPad,
  KEY_STICKS,
  migrateConfig,
  NEUTRAL_PAD,
  padsEqual,
  readGamepad,
  toJoy,
  ZERO_VECTOR,
} from "@lichtblick/suite-base/panels/Teleop/twist";
import {
  ButtonName,
  DirectionalPadAction,
  PadState,
  TeleopConfig,
  TeleopPanelProps,
  TeleopVector,
} from "@lichtblick/suite-base/panels/Teleop/types";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import { ros2CommonDatatypes } from "@lichtblick/suite-base/util/ros2CommonDatatypes";

const SCHEMAS = {
  Twist: "geometry_msgs/Twist",
  TwistStamped: "geometry_msgs/TwistStamped",
  Joy: "sensor_msgs/Joy",
} as const;

type InputSources = {
  /** On-screen controls, held with mouse, touch or pen */
  pointerLeft?: TeleopVector;
  pointerRight?: TeleopVector;
  pointerButtons: Set<ButtonName>;
  /** Lowercased `KeyboardEvent.key` values currently held */
  keys: Set<string>;
  gamepad: PadState;
};

/** The command being sent, as last computed from the inputs */
type Command = {
  pad: PadState;
  turbo: boolean;
  /** Stopped until every control is released */
  latched: boolean;
  /** Gamepad sticks move but the enable button isn't held */
  needsEnable: boolean;
};

const IDLE: Command = { pad: NEUTRAL_PAD, turbo: false, latched: false, needsEnable: false };

function emptySources(): InputSources {
  return { pointerButtons: new Set(), keys: new Set(), gamepad: NEUTRAL_PAD };
}

function speedOf(config: TeleopConfig, { turbo }: Pick<Command, "turbo">): number {
  return turbo ? 1 : config.speedScale;
}

function buildMessage(config: TeleopConfig, { pad, turbo }: Pick<Command, "pad" | "turbo">) {
  const now = Date.now();
  // ponytail: wall-clock stamp; robots running on sim time (/clock) may reject it
  const header = {
    stamp: { sec: Math.floor(now / 1000), nsec: (now % 1000) * 1e6 },
    frame_id: config.frameId,
  };
  if (config.messageType === "Joy") {
    const joy = toJoy(pad, config.joyEnableButton);
    const active = joy.axes.some((value) => value !== 0) || joy.buttons.some(Boolean);
    return { active, message: { header, ...joy } };
  }
  const twist = computeTwist(config.mapping, pad, speedOf(config, { turbo }));
  return {
    active: !isZeroTwist(twist),
    message: config.messageType === "TwistStamped" ? { header, twist } : twist,
  };
}

function formatCommand(config: TeleopConfig, command: Command): string {
  if (config.messageType === "Joy") {
    const { axes, buttons } = toJoy(command.pad, config.joyEnableButton);
    const axisParts = ["LX", "LY", "RX", "RY", "LT", "RT"]
      .map((name, index) => [name, axes[index] ?? 0] as const)
      .filter(([, value]) => value !== 0)
      .map(([name, value]) => `${name} ${value.toFixed(2)}`);
    const buttonParts = buttons.flatMap((value, index) => (value === 1 ? [`b${index}`] : []));
    const parts = [...axisParts, ...buttonParts];
    return parts.length > 0 ? parts.join("  ") : "Idle";
  }
  const twist = computeTwist(config.mapping, command.pad, speedOf(config, command));
  const parts = (["linear", "angular"] as const).flatMap((kind) =>
    (["x", "y", "z"] as const)
      .filter((axis) => twist[kind][axis] !== 0)
      .map((axis) => `${kind}.${axis} ${twist[kind][axis].toFixed(2)}`),
  );
  return parts.length > 0 ? parts.join("  ") : "Stopped";
}

/** "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: …)" → "Xbox Wireless Controller" */
function shortGamepadName(id: string): string {
  return id.replace(/\s*\(.*\)\s*$/, "") || id;
}

function TeleopPanel(props: Readonly<TeleopPanelProps>): React.JSX.Element {
  const { context } = props;
  const { saveState } = context;

  const [topics, setTopics] = useState<readonly Topic[]>([]);
  const [gamepadIds, setGamepadIds] = useState<readonly string[]>([]);

  // everything the user can change lives in the config, which is saved with the layout, so
  // reopening the panel or switching layout tabs restores it exactly
  const [config, setConfig] = useState<TeleopConfig>(() => migrateConfig(context.initialState));

  const settingsActionHandler = useCallback((action: SettingsTreeAction) => {
    setConfig((previous) => applySettingsAction(previous, action));
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
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: buildSettingsTreeTeleop(config, topics, gamepadIds),
    });
  }, [config, context, gamepadIds, settingsActionHandler, topics]);

  useEffect(() => {
    saveState(config);
  }, [config, saveState]);

  const { topic: currentTopic, messageType } = config;
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

  // whether the last message sent moved the robot; cleanup stops it even when stopOnRelease
  // skipped the zero
  const lastPublishedActive = useRef(false);
  const publishCommand = useCallback(
    (command: Pick<Command, "pad" | "turbo">) => {
      const { config: cfg, enabled: canSend } = latest.current;
      if (!canSend || !cfg.topic) {
        return;
      }
      const { active, message } = buildMessage(cfg, command);
      lastPublishedActive.current = active;
      try {
        context.publish?.(cfg.topic, message);
      } catch (error) {
        console.error("Failed to publish message:", error);
      }
    },
    [context],
  );
  const publishStop = useCallback(() => {
    publishCommand(IDLE);
  }, [publishCommand]);

  const sources = useRef<InputSources>(emptySources());
  const latched = useRef(false);
  const commandRef = useRef<Command>(IDLE);
  const activeRef = useRef(false);
  const [command, setCommand] = useState<Command>(IDLE);

  // Merge every input source into one virtual gamepad and publish immediately on start and stop
  // instead of waiting for the next tick.
  const updateCommand = useCallback(() => {
    const { config: cfg } = latest.current;
    const isTwist = cfg.messageType !== "Joy";
    const { pointerLeft, pointerRight, pointerButtons, keys, gamepad } = sources.current;
    const pointer: PadState = {
      ...NEUTRAL_PAD,
      left: pointerLeft ?? ZERO_VECTOR,
      right: pointerRight ?? ZERO_VECTOR,
      buttons: pointerButtons,
    };
    const keyboard = keysToPad(keys);
    const raw = combinePads([pointer, keyboard, gamepad]);
    if (latched.current && isNeutral(raw)) {
      latched.current = false;
    }
    const gamepadMoves =
      isActive(gamepad.left) || isActive(gamepad.right) || gamepad.lt + gamepad.rt > 0;
    const needsEnable =
      isTwist && cfg.enableButton !== "none" && !hasButton(gamepad, cfg.enableButton);
    const gamepadDrive = needsEnable ? { ...NEUTRAL_PAD, buttons: gamepad.buttons } : gamepad;
    const next: Command = {
      pad: latched.current ? NEUTRAL_PAD : combinePads([pointer, keyboard, gamepadDrive]),
      turbo: isTwist && (keys.has("shift") || hasButton(gamepad, cfg.turboButton)),
      latched: latched.current,
      needsEnable: needsEnable && gamepadMoves,
    };
    const prev = commandRef.current;
    const wasActive = activeRef.current;
    // also depends on the config: a speed or mapping change can start or stop a held command
    const active = buildMessage(cfg, next).active;
    if (
      active === wasActive &&
      padsEqual(prev.pad, next.pad) &&
      prev.turbo === next.turbo &&
      prev.latched === next.latched &&
      prev.needsEnable === next.needsEnable
    ) {
      return;
    }
    commandRef.current = next;
    setCommand(next);
    activeRef.current = active;
    if (active && !wasActive) {
      publishCommand(next);
    } else if (!active && wasActive && cfg.stopOnRelease) {
      publishStop();
    }
  }, [publishCommand, publishStop]);

  // bumping this remounts the on-screen controls, dropping their drag and pointer capture so a
  // mouse whose release we never saw can't keep driving
  const [releaseCount, setReleaseCount] = useState(0);
  const releaseAll = useCallback(() => {
    sources.current = { ...emptySources(), gamepad: sources.current.gamepad };
    setReleaseCount((count) => count + 1);
    updateCommand();
  }, [updateCommand]);

  const emergencyStop = useCallback(() => {
    latched.current = true;
    updateCommand();
    activeRef.current = false;
    publishStop();
  }, [publishStop, updateCommand]);

  const changeSpeed = useCallback((delta: number) => {
    setConfig((previous) => ({
      ...previous,
      speedScale: _.clamp(Math.round((previous.speedScale + delta) * 100) / 100, 0.05, 1),
    }));
  }, []);
  const setSpeed = useCallback((speedScale: number) => {
    setConfig((previous) => ({ ...previous, speedScale }));
  }, []);

  // speed changes the published values of a held command
  useEffect(() => {
    updateCommand();
  }, [config, updateCommand]);

  // advertise topic
  const isInitialMount = useRef(true);
  useLayoutEffect(() => {
    if (!currentTopic) {
      return;
    }

    const isRos2 = context.dataSourceProfile === "ros2";
    const definitions: Record<string, MessageDefinition> = isRos2 ? ros2CommonDatatypes() : ros1;
    const rootType = SCHEMAS[messageType];
    // ROS 2 schema names include "/msg/"; the definition maps use the short names
    const schemaName = isRos2 ? rootType.replace("/", "/msg/") : rootType;
    const rootDefinition = definitions[rootType];
    if (!rootDefinition) {
      return;
    }
    const datatypes = new Map<string, MessageDefinition>([[schemaName, rootDefinition]]);
    for (const name of [
      rootType,
      "geometry_msgs/Vector3",
      "geometry_msgs/Twist",
      "std_msgs/Header",
    ]) {
      const definition = definitions[name];
      if (definition) {
        datatypes.set(name, definition);
      }
    }
    context.advertise?.(currentTopic, schemaName, { datatypes });

    return () => {
      // never leave the robot driving on a topic we stop publishing to
      if (lastPublishedActive.current) {
        publishStop();
      }
      if (!isInitialMount.current) {
        context.unadvertise?.(currentTopic);
      }
      isInitialMount.current = false;
    };
  }, [context, currentTopic, messageType, publishStop]);

  // keep publishing while a command is held so the robot's command timeout doesn't trip
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const intervalHandle = setInterval(() => {
      if (activeRef.current) {
        publishCommand(commandRef.current);
      }
    }, 1000 / config.publishRate);
    return () => {
      clearInterval(intervalHandle);
    };
  }, [enabled, config.publishRate, publishCommand]);

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
  const [gamepadNonStandard, setGamepadNonStandard] = useState(false);
  const gamepadEnabled = config.gamepad;
  useEffect(() => {
    if (!gamepadEnabled || typeof navigator.getGamepads !== "function") {
      return;
    }
    let frame = 0;
    // Gamepad.timestamp only changes with new input, so an idle pad isn't re-read every frame
    let lastReadKey = "";
    const poll = () => {
      const { config: cfg } = latest.current;
      const pads = navigator.getGamepads().filter((pad): pad is Gamepad => pad?.connected === true);
      const ids = pads.map((pad) => pad.id);
      setGamepadIds((previous) => (_.isEqual(previous, ids) ? previous : ids));
      const pad = cfg.gamepadId ? pads.find((p) => p.id === cfg.gamepadId) : pads[0];
      setGamepadName(pad?.id);
      setGamepadNonStandard(pad != undefined && pad.mapping !== "standard");

      const readKey =
        pad && document.hasFocus() ? `${pad.id}:${pad.timestamp}:${cfg.gamepadDeadzone}` : "";
      const prev = sources.current.gamepad;
      const next =
        readKey === lastReadKey
          ? prev
          : pad && readKey
            ? readGamepad(pad, cfg.gamepadDeadzone)
            : NEUTRAL_PAD;
      lastReadKey = readKey;
      if (!padsEqual(next, prev)) {
        sources.current.gamepad = next;
        const pressed = (button: ButtonName | "none") =>
          button !== "none" && next.buttons.has(button) && !prev.buttons.has(button);
        if (cfg.messageType !== "Joy") {
          if (pressed(cfg.speedUpButton)) {
            changeSpeed(0.1);
          }
          if (pressed(cfg.speedDownButton)) {
            changeSpeed(-0.1);
          }
        }
        if (cfg.messageType !== "Joy" && pressed(cfg.stopButton)) {
          emergencyStop();
        } else {
          updateCommand();
        }
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(frame);
      sources.current.gamepad = NEUTRAL_PAD;
      setGamepadName(undefined);
      updateCommand();
    };
  }, [gamepadEnabled, changeSpeed, emergencyStop, updateCommand]);

  const setPointerLeft = useCallback(
    (next?: TeleopVector) => {
      sources.current.pointerLeft = next;
      updateCommand();
    },
    [updateCommand],
  );
  const setPointerRight = useCallback(
    (next?: TeleopVector) => {
      sources.current.pointerRight = next;
      updateCommand();
    },
    [updateCommand],
  );
  const onDirectionalPadAction = useCallback(
    (action?: DirectionalPadAction) => {
      setPointerLeft(action == undefined ? undefined : actionToVector(action));
    },
    [setPointerLeft],
  );
  const pressFaceButton = useCallback(
    (button: ButtonName) => {
      sources.current.pointerButtons.add(button);
      updateCommand();
    },
    [updateCommand],
  );
  const releaseFaceButton = useCallback(
    (button: ButtonName) => {
      if (sources.current.pointerButtons.delete(button)) {
        updateCommand();
      }
    },
    [updateCommand],
  );

  const [focused, setFocused] = useState(false);
  const isTwist = messageType !== "Joy";

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
    if (isTwist && (key === "+" || key === "=" || key === "-")) {
      changeSpeed(key === "-" ? -0.1 : 0.1);
      return;
    }
    if (KEY_STICKS[key] == undefined && key !== "shift") {
      return;
    }
    event.preventDefault();
    sources.current.keys.add(key);
    updateCommand();
  };

  const onKeyUp = (event: React.KeyboardEvent) => {
    if (sources.current.keys.delete(event.key.toLowerCase())) {
      updateCommand();
    }
  };

  useLayoutEffect(() => {
    renderDone();
  }, [renderDone]);

  const hints = [
    command.latched && "Stopped · release all controls to drive again",
    command.needsEnable &&
      config.enableButton !== "none" &&
      `Hold ${BUTTON_LABELS[config.enableButton]} to drive`,
    config.keyboard &&
      (focused
        ? `WASD · Q/E${isTwist ? " · Shift turbo · +/− speed" : ""} · Space stop`
        : "Click the panel to use the keyboard"),
    config.gamepad &&
      (gamepadName
        ? `Gamepad: ${shortGamepadName(gamepadName)}${gamepadNonStandard ? " (unknown layout, sticks may be swapped)" : ""}`
        : "Press a gamepad button to connect it"),
  ].filter(Boolean);

  const controls = [
    config.mode === "joystick" && (
      <Joystick key={`left-${releaseCount}`} vector={command.pad.left} onChange={setPointerLeft} />
    ),
    config.mode === "dual" && (
      <Joystick
        key={`left-${releaseCount}`}
        label="Left stick"
        vector={command.pad.left}
        onChange={setPointerLeft}
      />
    ),
    config.mode === "dual" && (
      <Joystick
        key={`right-${releaseCount}`}
        label="Right stick"
        vector={command.pad.right}
        onChange={setPointerRight}
      />
    ),
    config.mode === "dpad" && (
      <DirectionalPad
        key={`dpad-${releaseCount}`}
        onAction={onDirectionalPadAction}
        vector={command.pad.left}
      />
    ),
    !isTwist && config.mode !== "none" && (
      <FaceButtons
        key={`buttons-${releaseCount}`}
        pressed={command.pad.buttons}
        onPress={pressFaceButton}
        onRelease={releaseFaceButton}
      />
    ),
  ].filter(Boolean);

  const speedPercent = Math.round(speedOf(config, command) * 100);

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
            sources.current.keys.clear();
            updateCommand();
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
                {isTwist ? (
                  <>
                    <Typography
                      variant="caption"
                      color={command.turbo ? "warning.main" : "text.secondary"}
                      noWrap
                      flexShrink={0}
                      style={{ minWidth: "9ch", textAlign: "left" }}
                    >
                      {command.turbo ? "Turbo" : "Speed"} {speedPercent}%
                    </Typography>
                    <Slider
                      size="small"
                      aria-label="Speed"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={config.speedScale}
                      onChange={(_event, value) => {
                        setSpeed(value);
                      }}
                    />
                  </>
                ) : (
                  <Typography variant="caption" color="text.secondary" flex="auto" textAlign="left">
                    sensor_msgs/Joy
                  </Typography>
                )}
                <Button
                  size="small"
                  variant={command.latched ? "contained" : "outlined"}
                  color="error"
                  onClick={emergencyStop}
                  style={{ flexShrink: 0 }}
                >
                  Stop
                </Button>
              </Stack>
              {controls.length > 0 && (
                <Stack
                  direction="row"
                  flex="auto"
                  fullWidth
                  gap={1}
                  justifyContent="center"
                  alignItems="center"
                  overflow="hidden"
                >
                  {controls.map((control, index) => (
                    <Stack
                      key={index}
                      flex="1 1 0"
                      fullHeight
                      justifyContent="center"
                      alignItems="center"
                      style={{ minWidth: 0 }}
                    >
                      {control}
                    </Stack>
                  ))}
                </Stack>
              )}
              <Typography
                variant="caption"
                fontFamily="monospace"
                color={buildMessage(config, command).active ? "primary" : "text.secondary"}
                noWrap
              >
                {formatCommand(config, command)}
              </Typography>
              {hints.map((hint, index) => (
                <Typography
                  key={index}
                  variant="caption"
                  color={index === 0 && command.latched ? "error" : "text.secondary"}
                  noWrap
                >
                  {hint}
                </Typography>
              ))}
            </>
          )}
        </Stack>
      </div>
    </ThemeProvider>
  );
}

export default TeleopPanel;
