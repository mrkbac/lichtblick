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
  it("maps half-axes proportionally onto the configured buttons", () => {
    expect(computeTwist(DEFAULT_CONFIG, { x: 0.5, y: -0.25 })).toEqual({
      linear: { x: -0.25, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: -0.5 },
    });
  });

  it("applies the speed scale and sums buttons sharing a field", () => {
    const config = {
      ...DEFAULT_CONFIG,
      speedScale: 0.5,
      rightButton: { field: "linear-x", value: 2 },
    };
    expect(computeTwist(config, { x: 1, y: 1 }).linear.x).toBe(1.5);
  });

  it("ignores unknown fields", () => {
    const config = { ...DEFAULT_CONFIG, upButton: { field: "__proto__-x", value: 1 } };
    expect(computeTwist(config, { x: 0, y: 1 })).toEqual(zeroTwist());
  });
});

describe("applyDeadzone", () => {
  it("zeroes small deflections and rescales the rest to start at zero", () => {
    expect(applyDeadzone(0.1, 0, 0.2)).toEqual({ x: 0, y: 0 });
    expect(applyDeadzone(0.6, 0, 0.2).x).toBeCloseTo(0.5);
    expect(applyDeadzone(0, -1, 0.2)).toEqual({ x: 0, y: -1 });
  });
});

describe("clampToUnit", () => {
  it("keeps vectors inside the unit circle", () => {
    expect(clampToUnit(3, 4)).toEqual({ x: 0.6, y: 0.8 });
    expect(clampToUnit(0.3, 0.4)).toEqual({ x: 0.3, y: 0.4 });
  });
});
