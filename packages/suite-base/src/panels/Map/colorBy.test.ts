// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { normalize, sampleAt, speedValues, valueRange } from "./colorBy";
import { offsetMeters } from "./geo";

describe("colorBy", () => {
  it("computes speed over a time window", () => {
    // 10 m/s east, sampled at 10 Hz.
    const fixes = Array.from({ length: 20 }, (_, i) => ({
      time: i / 10,
      position: offsetMeters([8, 47], i, 0),
    }));
    const speeds = speedValues(fixes, "metric");
    expect(speeds).toHaveLength(20);
    for (const speed of speeds) {
      expect(speed).toBeCloseTo(36, 1); // km/h
    }
    expect(speedValues([fixes[0]!], "metric")).toEqual([undefined]);
  });

  it("looks up the latest sample at or before each time", () => {
    const samples = [
      { time: 1, value: 10 },
      { time: 2, value: 20 },
    ];
    expect(sampleAt(samples, [0.5, 1, 1.5, 2, 9])).toEqual([undefined, 10, 10, 20, 20]);
  });

  it("derives a robust range unless bounds are given", () => {
    const values = [...Array.from({ length: 100 }, (_, i) => i), 10_000, undefined];
    expect(valueRange(values, undefined, undefined)).toEqual([2, 98]);
    expect(valueRange(values, 0, 50)).toEqual([0, 50]);
    expect(valueRange([5, 5], undefined, undefined)).toEqual([5, 6]);
    expect(valueRange([undefined], undefined, undefined)).toBeUndefined();
    expect(normalize(150, [50, 100])).toBe(1);
    expect(normalize(75, [50, 100])).toBe(0.5);
  });
});
