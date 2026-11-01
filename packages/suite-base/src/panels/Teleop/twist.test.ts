// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { DEFAULT_CONFIG } from "@lichtblick/suite-base/panels/Teleop/constants";
import {
  applyDeadzone,
  clampToUnit,
  computeTwist,
  zeroTwist,
} from "@lichtblick/suite-base/panels/Teleop/twist";

describe("computeTwist", () => {
  it("maps each half-axis proportionally onto its configured button", () => {
    // Given the default forward/turn mapping
    // When the vector is half right and a quarter backward
    const twist = computeTwist(DEFAULT_CONFIG, { x: 0.5, y: -0.25 });

    // Then the down and right buttons contribute their scaled values
    expect(twist).toEqual({
      linear: { x: -0.25, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: -0.5 },
    });
  });

  it("applies the speed scale and sums buttons that share a field", () => {
    // Given half speed and the right button also driving linear-x
    const config = {
      ...DEFAULT_CONFIG,
      speedScale: 0.5,
      rightButton: { field: "linear-x", value: 2 },
    };

    // When fully deflected up and right
    const twist = computeTwist(config, { x: 1, y: 1 });

    // Then both contributions are summed and halved
    expect(twist.linear.x).toBe(1.5);
  });

  it("ignores unknown fields and non-numeric values", () => {
    // Given an invalid field and a value cleared in the settings editor
    const config = {
      ...DEFAULT_CONFIG,
      upButton: { field: "__proto__-x", value: 1 },
      rightButton: { field: "angular-z", value: undefined as unknown as number },
    };

    // When fully deflected up and right
    const twist = computeTwist(config, { x: 1, y: 1 });

    // Then nothing is published instead of NaN
    expect(twist).toEqual(zeroTwist());
  });
});

describe("applyDeadzone", () => {
  it("zeroes deflections inside the deadzone and rescales the rest to start at zero", () => {
    // Given a deadzone of 0.2
    // When the stick is inside, partly past and fully past the deadzone
    // Then output is zero, rescaled and unchanged respectively
    expect(applyDeadzone(0.1, 0, 0.2)).toEqual({ x: 0, y: 0 });
    expect(applyDeadzone(0.6, 0, 0.2).x).toBeCloseTo(0.5);
    expect(applyDeadzone(0, -1, 0.2)).toEqual({ x: 0, y: -1 });
  });

  it("returns no motion for a non-numeric deadzone", () => {
    // Given a deadzone cleared in the settings editor
    // When the stick is centered or fully deflected
    // Then no motion is produced instead of NaN
    expect(applyDeadzone(0, 0, Number.NaN)).toEqual({ x: 0, y: 0 });
    expect(applyDeadzone(1, 0, undefined as unknown as number)).toEqual({ x: 0, y: 0 });
  });
});

describe("clampToUnit", () => {
  it("scales vectors outside the unit circle onto it and leaves others unchanged", () => {
    // Given vectors outside and inside the unit circle
    // When clamped
    // Then only the outside one is scaled down
    expect(clampToUnit(3, 4)).toEqual({ x: 0.6, y: 0.8 });
    expect(clampToUnit(0.3, 0.4)).toEqual({ x: 0.3, y: 0.4 });
  });
});
