// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";

import {
  DEFAULT_CONFIG,
  JOY_BUTTON_COUNT,
  JOY_BUTTONS,
  STANDARD_BUTTONS,
  TWIST_FIELDS,
} from "@lichtblick/suite-base/panels/Teleop/constants";
import {
  AxisInput,
  ButtonSetting,
  DirectionalPadAction,
  PadState,
  TeleopConfig,
  TeleopVector,
  Twist,
  TwistField,
} from "@lichtblick/suite-base/panels/Teleop/types";

export const ZERO_VECTOR: TeleopVector = { x: 0, y: 0 };

export const NEUTRAL_PAD: PadState = {
  left: ZERO_VECTOR,
  right: ZERO_VECTOR,
  lt: 0,
  rt: 0,
  buttons: new Set(),
};

export function zeroTwist(): Twist {
  return { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
}

export function isActive(vector: TeleopVector): boolean {
  return vector.x !== 0 || vector.y !== 0;
}

/** True when no stick, trigger or button is in use */
export function isNeutral(pad: PadState): boolean {
  return (
    !isActive(pad.left) &&
    !isActive(pad.right) &&
    pad.lt === 0 &&
    pad.rt === 0 &&
    pad.buttons.size === 0
  );
}

export function padsEqual(a: PadState, b: PadState): boolean {
  return (
    a.left.x === b.left.x &&
    a.left.y === b.left.y &&
    a.right.x === b.right.x &&
    a.right.y === b.right.y &&
    a.lt === b.lt &&
    a.rt === b.rt &&
    a.buttons.size === b.buttons.size &&
    [...a.buttons].every((button) => b.buttons.has(button))
  );
}

export function hasButton(pad: PadState, button: ButtonSetting): boolean {
  return button !== "none" && pad.buttons.has(button);
}

export function actionToVector(action: DirectionalPadAction): TeleopVector {
  switch (action) {
    case DirectionalPadAction.UP:
      return { x: 0, y: 1 };
    case DirectionalPadAction.DOWN:
      return { x: 0, y: -1 };
    case DirectionalPadAction.LEFT:
      return { x: -1, y: 0 };
    case DirectionalPadAction.RIGHT:
      return { x: 1, y: 0 };
  }
}

/** Radial deadzone, rescaled so output starts at 0 just past the deadzone */
export function applyDeadzone(x: number, y: number, deadzone: number): TeleopVector {
  const magnitude = Math.hypot(x, y);
  // negated so a non-numeric deadzone (cleared settings field) yields no motion
  if (!(magnitude > deadzone) || !(deadzone < 1)) {
    return ZERO_VECTOR;
  }
  const scale = Math.min(1, (magnitude - deadzone) / (1 - deadzone)) / magnitude;
  return { x: x * scale, y: y * scale };
}

/** Clamps a vector to the unit circle */
export function clampToUnit(x: number, y: number): TeleopVector {
  const magnitude = Math.hypot(x, y);
  return magnitude > 1 ? { x: x / magnitude, y: y / magnitude } : { x, y };
}

type GamepadLike = Pick<Gamepad, "axes" | "buttons">;

/** Reads a W3C "standard" mapping gamepad; the browser's y axes point down */
export function readGamepad(pad: GamepadLike, deadzone: number): PadState {
  const trigger = (index: number) => {
    const value = pad.buttons[index]?.value ?? 0;
    return value > deadzone ? Math.min(1, (value - deadzone) / (1 - deadzone)) : 0;
  };
  return {
    left: applyDeadzone(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0), deadzone),
    right: applyDeadzone(pad.axes[2] ?? 0, -(pad.axes[3] ?? 0), deadzone),
    lt: trigger(6),
    rt: trigger(7),
    buttons: new Set(
      STANDARD_BUTTONS.filter((_name, index) => pad.buttons[index]?.pressed === true),
    ),
  };
}

/** Lowercased `KeyboardEvent.key` values that move a stick */
export const KEY_STICKS: Record<string, { stick: "left" | "right"; vector: TeleopVector }> = {
  w: { stick: "left", vector: { x: 0, y: 1 } },
  arrowup: { stick: "left", vector: { x: 0, y: 1 } },
  s: { stick: "left", vector: { x: 0, y: -1 } },
  arrowdown: { stick: "left", vector: { x: 0, y: -1 } },
  a: { stick: "left", vector: { x: -1, y: 0 } },
  arrowleft: { stick: "left", vector: { x: -1, y: 0 } },
  d: { stick: "left", vector: { x: 1, y: 0 } },
  arrowright: { stick: "left", vector: { x: 1, y: 0 } },
  q: { stick: "right", vector: { x: -1, y: 0 } },
  e: { stick: "right", vector: { x: 1, y: 0 } },
};

export function keysToPad(keys: ReadonlySet<string>): PadState {
  const left = { x: 0, y: 0 };
  const right = { x: 0, y: 0 };
  for (const key of keys) {
    const binding = KEY_STICKS[key];
    if (binding) {
      const stick = binding.stick === "left" ? left : right;
      stick.x += binding.vector.x;
      stick.y += binding.vector.y;
    }
  }
  return { ...NEUTRAL_PAD, left, right };
}

/** Each stick follows the first source that moves it; triggers take the max, buttons the union */
export function combinePads(pads: readonly PadState[]): PadState {
  return {
    left: pads.find((pad) => isActive(pad.left))?.left ?? ZERO_VECTOR,
    right: pads.find((pad) => isActive(pad.right))?.right ?? ZERO_VECTOR,
    lt: Math.max(0, ...pads.map((pad) => pad.lt)),
    rt: Math.max(0, ...pads.map((pad) => pad.rt)),
    buttons: new Set(pads.flatMap((pad) => [...pad.buttons])),
  };
}

/** ROS sign convention: sticks positive to the left and forward */
export function axisValue(pad: PadState, input: AxisInput): number {
  switch (input) {
    case "leftX":
      return -pad.left.x;
    case "leftY":
      return pad.left.y;
    case "rightX":
      return -pad.right.x;
    case "rightY":
      return pad.right.y;
    case "triggers":
      return pad.rt - pad.lt;
    case "none":
      return 0;
  }
}

export function computeTwist(
  mapping: TeleopConfig["mapping"],
  pad: PadState,
  speed: number,
): Twist {
  const twist = zeroTwist();
  for (const field of TWIST_FIELDS) {
    const { input, max } = mapping[field];
    // a cleared number field in the settings arrives as undefined; never publish NaN
    if (!Number.isFinite(max) || !Number.isFinite(speed)) {
      continue;
    }
    const [kind, axis] = field.split("-") as ["linear" | "angular", "x" | "y" | "z"];
    // `+ 0` turns -0 into 0 so idle readouts and messages stay clean
    twist[kind][axis] = axisValue(pad, input) * max * speed + 0;
  }
  return twist;
}

export function isZeroTwist(twist: Twist): boolean {
  return Object.values(twist.linear)
    .concat(Object.values(twist.angular))
    .every((value) => value === 0);
}

/**
 * `sensor_msgs/Joy` axes and buttons in the layout of the ROS 2 `joy` driver: sticks positive to
 * the left and forward, triggers 0 released to -1 pressed.
 */
export function toJoy(
  pad: PadState,
  holdButton: ButtonSetting,
): { axes: number[]; buttons: number[] } {
  const axes = [-pad.left.x, pad.left.y, -pad.right.x, pad.right.y, -pad.lt, -pad.rt].map(
    (value) => value + 0,
  );
  const driving = axes.some((value) => value !== 0);
  const buttons = Array.from({ length: JOY_BUTTON_COUNT }, (_unused, index) => {
    const name = JOY_BUTTONS[index];
    return name != undefined && (pad.buttons.has(name) || (driving && name === holdButton)) ? 1 : 0;
  });
  return { axes, buttons };
}

type LegacyButton = { field?: string; value?: number };
type LegacyConfig = Partial<
  Record<"upButton" | "downButton" | "leftButton" | "rightButton", LegacyButton>
>;

/**
 * Fills a saved (possibly partial or older) config with defaults. Configs from before the
 * per-field mapping drove four buttons (up/down/left/right) that each set one field; they become
 * the left stick axes.
 */
export function migrateConfig(saved: unknown): TeleopConfig {
  const { upButton, downButton, leftButton, rightButton, ...rest } = (saved ??
    {}) as Partial<TeleopConfig> & LegacyConfig;
  const config = _.merge(_.cloneDeep(DEFAULT_CONFIG), rest);
  if (rest.mapping == undefined && (upButton ?? downButton ?? leftButton ?? rightButton)) {
    config.mapping = _.mapValues(DEFAULT_CONFIG.mapping, () => ({
      input: "none" as const,
      max: 1,
    }));
    const legacy: [LegacyButton | undefined, AxisInput, number][] = [
      [upButton, "leftY", 1],
      [downButton, "leftY", -1],
      [leftButton, "leftX", 1],
      [rightButton, "leftX", -1],
    ];
    for (const [button, input, sign] of legacy) {
      const field = button?.field?.replace(".", "-") as TwistField | undefined;
      const value = button?.value;
      // the opposite button of a pair usually mirrors the first; the first one wins
      if (
        field != undefined &&
        TWIST_FIELDS.includes(field) &&
        config.mapping[field].input === "none" &&
        typeof value === "number"
      ) {
        config.mapping[field] = { input, max: value * sign };
      }
    }
  }
  return config;
}
