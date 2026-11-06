// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { DEFAULT_CONFIG } from "@lichtblick/suite-base/panels/Teleop/constants";
import {
  applyDeadzone,
  clampToUnit,
  combinePads,
  computeTwist,
  keysToPad,
  migrateConfig,
  NEUTRAL_PAD,
  readGamepad,
  toJoy,
} from "@lichtblick/suite-base/panels/Teleop/twist";
import { PadState } from "@lichtblick/suite-base/panels/Teleop/types";

function pad(overrides: Partial<PadState>): PadState {
  return { ...NEUTRAL_PAD, ...overrides };
}

function gamepad(axes: number[], pressed: Record<number, number> = {}) {
  const buttons = Array.from({ length: 17 }, (_unused, index) => {
    const value = pressed[index] ?? 0;
    return { pressed: value > 0, touched: value > 0, value };
  });
  return { axes, buttons };
}

describe("computeTwist", () => {
  it("drives forward and turns with the left stick by default, in ROS signs", () => {
    // Given the default mapping (linear.x ← left ↕ max 1, angular.z ← left ↔ max 1.5)
    // When the stick is pushed half forward and fully right
    const twist = computeTwist(DEFAULT_CONFIG.mapping, pad({ left: { x: 1, y: 0.5 } }), 1);

    // Then the robot drives forward and turns clockwise (negative yaw)
    expect(twist).toEqual({
      linear: { x: 0.5, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: -1.5 },
    });
  });

  it("scales by speed, follows triggers and ignores cleared max values", () => {
    // Given linear.x on the triggers and a cleared angular.z max
    const mapping = {
      ...DEFAULT_CONFIG.mapping,
      "linear-x": { input: "triggers" as const, max: 2 },
      "angular-z": { input: "leftX" as const, max: undefined as unknown as number },
    };

    // When the right trigger is fully pressed at half speed
    const twist = computeTwist(mapping, pad({ rt: 1, left: { x: 1, y: 0 } }), 0.5);

    // Then only linear.x moves, never NaN
    expect(twist).toEqual({ linear: { x: 1, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } });
  });
});

describe("readGamepad", () => {
  it("flips the browser's y axes, applies the deadzone and reads named buttons", () => {
    // Given a standard gamepad with the left stick up, right stick inside the deadzone, A and RT
    const state = readGamepad(gamepad([0, -1, 0.05, 0], { 0: 1, 7: 1 }), 0.1);

    // Then forward is positive, noise is dropped and buttons are named
    expect(state.left).toEqual({ x: 0, y: 1 });
    expect(state.right).toEqual({ x: 0, y: 0 });
    expect(state.rt).toBe(1);
    expect([...state.buttons].sort()).toEqual(["a", "rt"]);
  });
});

describe("keysToPad and combinePads", () => {
  it("moves the left stick with WASD and the right stick with Q/E", () => {
    const state = keysToPad(new Set(["w", "d", "q", "shift"]));
    expect(state.left).toEqual({ x: 1, y: 1 });
    expect(state.right).toEqual({ x: -1, y: 0 });
  });

  it("lets the first source that moves a stick win and merges buttons", () => {
    // Given the pointer on the left stick and a gamepad on both sticks
    const pointer = pad({ left: { x: 0, y: 0.2 }, buttons: new Set(["a"]) });
    const pads = pad({ left: { x: 1, y: 0 }, right: { x: 0, y: 1 }, buttons: new Set(["b"]) });

    // When combined
    const combined = combinePads([pointer, pads]);

    // Then the pointer owns the left stick, the gamepad the right one
    expect(combined.left).toEqual({ x: 0, y: 0.2 });
    expect(combined.right).toEqual({ x: 0, y: 1 });
    expect([...combined.buttons].sort()).toEqual(["a", "b"]);
  });
});

describe("toJoy", () => {
  it("uses the ROS 2 joy driver layout", () => {
    // Given left stick forward-left, left trigger pressed and buttons A, LB and d-pad up
    const state = pad({ left: { x: -1, y: 1 }, lt: 1, buttons: new Set(["a", "lb", "up"]) });

    // When converted
    const joy = toJoy(state, "none");

    // Then sticks are positive left/forward, triggers go to -1 and buttons use SDL order
    expect(joy.axes).toEqual([1, 1, 0, 0, -1, 0]);
    expect(joy.buttons).toHaveLength(21);
    expect(joy.buttons.flatMap((value, index) => (value === 1 ? [index] : []))).toEqual([0, 9, 11]);
  });

  it("holds the configured button only while a stick moves", () => {
    expect(toJoy(NEUTRAL_PAD, "lb").buttons[9]).toBe(0);
    expect(toJoy(pad({ right: { x: 0.5, y: 0 } }), "lb").buttons[9]).toBe(1);
  });
});

describe("migrateConfig", () => {
  it("fills missing fields with defaults", () => {
    expect(migrateConfig({ topic: "/drive", speedScale: 0.3 })).toEqual({
      ...DEFAULT_CONFIG,
      topic: "/drive",
      speedScale: 0.3,
    });
    expect(migrateConfig(undefined)).toEqual(DEFAULT_CONFIG);
  });

  it("keeps a cleared topic instead of falling back to the default", () => {
    expect(migrateConfig({ topic: "" }).topic).toBe("");
  });

  it("turns the old four-button config into left stick axes", () => {
    // Given a config saved before the per-field mapping
    const config = migrateConfig({
      upButton: { field: "linear-x", value: 0.8 },
      downButton: { field: "linear-x", value: -0.8 },
      leftButton: { field: "angular-z", value: 2 },
      rightButton: { field: "angular-z", value: -2 },
    });

    // Then forward/backward and left/right become the left stick with the same values
    expect(config.mapping["linear-x"]).toEqual({ input: "leftY", max: 0.8 });
    expect(config.mapping["angular-z"]).toEqual({ input: "leftX", max: 2 });
    expect(config.mapping["linear-y"].input).toBe("none");
    expect(config).not.toHaveProperty("upButton");
  });
});

describe("applyDeadzone", () => {
  it("zeroes deflections inside the deadzone and rescales the rest to start at zero", () => {
    expect(applyDeadzone(0.1, 0, 0.2)).toEqual({ x: 0, y: 0 });
    expect(applyDeadzone(0.6, 0, 0.2).x).toBeCloseTo(0.5);
    expect(applyDeadzone(0, -1, 0.2)).toEqual({ x: 0, y: -1 });
  });

  it("returns no motion for a non-numeric deadzone", () => {
    expect(applyDeadzone(0, 0, Number.NaN)).toEqual({ x: 0, y: 0 });
    expect(applyDeadzone(1, 0, undefined as unknown as number)).toEqual({ x: 0, y: 0 });
  });
});

describe("clampToUnit", () => {
  it("scales vectors outside the unit circle onto it and leaves others unchanged", () => {
    expect(clampToUnit(3, 4)).toEqual({ x: 0.6, y: 0.8 });
    expect(clampToUnit(0.3, 0.4)).toEqual({ x: 0.3, y: 0.4 });
  });
});
