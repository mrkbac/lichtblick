// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { offsetMeters } from "./geo";
import {
  angleDegrees,
  compassDirection,
  heightStats,
  measureFeatures,
  terrainSlope,
  TOOL_RULES,
} from "./measure";

const origin: [number, number] = [8, 47];
const east = offsetMeters(origin, 100, 0);
const north = offsetMeters(origin, 0, 100);

describe("measure", () => {
  it("measures angles in the plane and in 3D", () => {
    expect(angleDegrees(east, origin, north)).toBeCloseTo(90, 3);
    expect(angleDegrees(east, origin, offsetMeters(origin, 100, 100))).toBeCloseTo(45, 3);
    // Raising the north point by 100 m keeps it perpendicular to east...
    expect(angleDegrees(east, origin, north, [0, 0, 100])).toBeCloseTo(90, 3);
    // ...but raising the east point tilts the east ray up 45° from the horizontal.
    expect(angleDegrees(east, origin, offsetMeters(origin, 100, 0), [100, 0, 0])).toBeCloseTo(
      45,
      3,
    );
  });

  it("computes height difference, slope, and grade", () => {
    const stats = heightStats(origin, east, 500, 550);
    expect(stats.verticalMeters).toBe(50);
    expect(stats.horizontalMeters).toBeCloseTo(100, 1);
    expect(stats.slopeMeters).toBeCloseTo(Math.hypot(100, 50), 1);
    expect(stats.gradePercent).toBeCloseTo(50, 1);
    expect(stats.slopeDegrees).toBeCloseTo(26.57, 1);
  });

  it("builds geometry and handles per tool", () => {
    const pts = [origin, east, north];
    const kinds = (fc: ReturnType<typeof measureFeatures>) =>
      fc.features.map((f) => (f.properties?.kind as string | undefined) ?? f.geometry.type);
    expect(kinds(measureFeatures(1, pts, TOOL_RULES.distance, "area", undefined))).toEqual([
      "Polygon",
      "mid",
      "mid",
      "mid",
      "vertex",
      "vertex",
      "vertex",
    ]);
    expect(kinds(measureFeatures(1, pts.slice(0, 2), TOOL_RULES.height, "path", north))).toEqual([
      "LineString",
      "LineString",
      "vertex",
      "vertex",
    ]);
    expect(kinds(measureFeatures(1, pts, TOOL_RULES.point, "path", undefined))).toEqual([
      "vertex",
      "vertex",
      "vertex",
    ]);
  });

  it("derives terrain slope and facing direction", () => {
    // A plane rising 1 m per meter to the west faces east at 45°.
    const westUp = ([lon]: [number, number]) => -(lon - origin[0]) * 76_000;
    const slope = terrainSlope(origin, westUp, 10)!;
    expect(slope.slopeDegrees).toBeCloseTo(45, 0);
    expect(compassDirection(slope.aspectDegrees)).toBe("E");
    expect(terrainSlope(origin, () => 100)!.slopeDegrees).toBe(0);
    expect(terrainSlope(origin, () => undefined)).toBeUndefined();
  });
});
