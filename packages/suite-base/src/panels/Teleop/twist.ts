// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  DirectionalPadAction,
  TeleopButtonConfig,
  TeleopConfig,
  TeleopVector,
  Twist,
} from "@lichtblick/suite-base/panels/Teleop/types";

export const ZERO_VECTOR: TeleopVector = { x: 0, y: 0 };

export function zeroTwist(): Twist {
  return { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
}

export function isActive(vector: TeleopVector): boolean {
  return vector.x !== 0 || vector.y !== 0;
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

/**
 * Maps a normalized vector onto the configured buttons: each half-axis drives its button's
 * field proportionally, so a full deflection publishes exactly the button's value.
 */
export function computeTwist(config: TeleopConfig, vector: TeleopVector): Twist {
  const twist = zeroTwist();
  const add = ({ field, value }: TeleopButtonConfig, amount: number) => {
    const [kind, axis] = field.split("-");
    // a cleared number field in the settings arrives as undefined; never publish NaN
    if (!(amount > 0) || !Number.isFinite(value) || (kind !== "linear" && kind !== "angular")) {
      return;
    }
    if (axis === "x" || axis === "y" || axis === "z") {
      twist[kind][axis] += value * amount * config.speedScale;
    }
  };
  add(config.upButton, vector.y);
  add(config.downButton, -vector.y);
  add(config.rightButton, vector.x);
  add(config.leftButton, -vector.x);
  return twist;
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
