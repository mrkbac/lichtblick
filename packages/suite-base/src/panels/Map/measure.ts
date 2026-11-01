// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Feature, FeatureCollection } from "geojson";

import { distanceMeters, LngLat, offsetMeters } from "./geo";

export type MeasureTool = "distance" | "height" | "angle" | "point";

export type ToolRules = {
  /** Finish automatically once this many points are placed. */
  maxPoints?: number;
  /** Connect the points with lines. */
  lines: boolean;
  /** Show midpoint handles that insert points; clicking the first point closes an area. */
  editableShape: boolean;
};

export const TOOL_RULES: Record<MeasureTool, ToolRules> = {
  distance: { lines: true, editableShape: true },
  height: { maxPoints: 2, lines: true, editableShape: false },
  angle: { maxPoints: 3, lines: true, editableShape: false },
  point: { lines: false, editableShape: false },
};

/** Local east/north/up offset of `to` from `from` in meters (flat-earth, fine below ~10 km). */
function enu(from: LngLat, to: LngLat, up: number): [number, number, number] {
  const metersPerDegree = (6371008.8 * Math.PI) / 180;
  return [
    (to[0] - from[0]) * metersPerDegree * Math.cos((from[1] * Math.PI) / 180),
    (to[1] - from[1]) * metersPerDegree,
    up,
  ];
}

/**
 * Angle at `vertex` between the rays to `a` and `c`, in degrees. With elevations it is the true 3D
 * angle (as in point-cloud tools); without, the angle in the horizontal plane.
 */
export function angleDegrees(
  a: LngLat,
  vertex: LngLat,
  c: LngLat,
  elevations?: readonly [number, number, number],
): number {
  const [ea, ev, ec] = elevations ?? [0, 0, 0];
  const u = enu(vertex, a, ea - ev);
  const v = enu(vertex, c, ec - ev);
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const norm = Math.hypot(...u) * Math.hypot(...v);
  return norm === 0 ? 0 : (Math.acos(Math.max(-1, Math.min(1, dot / norm))) * 180) / Math.PI;
}

export type HeightStats = {
  /** b minus a; positive when b is higher. */
  verticalMeters: number;
  horizontalMeters: number;
  slopeMeters: number;
  gradePercent: number;
  slopeDegrees: number;
};

export function heightStats(
  a: LngLat,
  b: LngLat,
  elevationA: number,
  elevationB: number,
): HeightStats {
  const horizontalMeters = distanceMeters(a, b);
  const verticalMeters = elevationB - elevationA;
  return {
    verticalMeters,
    horizontalMeters,
    slopeMeters: Math.hypot(horizontalMeters, verticalMeters),
    gradePercent: horizontalMeters === 0 ? 0 : (verticalMeters / horizontalMeters) * 100,
    slopeDegrees: (Math.atan2(verticalMeters, horizontalMeters) * 180) / Math.PI,
  };
}

/** Geometry and handles for the measure overlay layers (see features.ts). */
export function measureFeatures(
  /** Stored as property `m` on every feature, to tell measurements apart when picking. */
  id: number,
  points: readonly LngLat[],
  rules: ToolRules,
  shape: "path" | "area",
  live: LngLat | undefined,
): FeatureCollection {
  const features: Feature[] = [];
  const isArea = shape === "area" && points.length >= 3;
  if (rules.lines && isArea) {
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...points, points[0]!]] },
      properties: { m: id },
    });
  } else if (rules.lines && points.length >= 2) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [...points] },
      properties: { m: id },
    });
  }
  const last = points[points.length - 1];
  if (rules.lines && live && last) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [last, live] },
      properties: { m: id, live: true },
    });
  }
  if (rules.editableShape) {
    // Midpoint handles insert a point into a segment (including the closing one of an area).
    const segments = isArea ? points.length : points.length - 1;
    for (let i = 0; i < segments; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
        properties: { m: id, kind: "mid", i },
      });
    }
  }
  points.forEach((coordinates, i) => {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates },
      properties: { m: id, kind: "vertex", i },
    });
  });
  return { type: "FeatureCollection", features };
}

export type TerrainSlope = {
  /** Steepness: 0° flat, 90° vertical. */
  slopeDegrees: number;
  /** Compass direction the slope faces (downhill), degrees clockwise from north. */
  aspectDegrees: number;
};

/**
 * Terrain steepness and facing at a point, from elevation samples `spacingMeters` around it.
 * ponytail: the DEM's resolution bounds the result; cliffs narrower than a DEM pixel read flatter.
 */
export function terrainSlope(
  point: LngLat,
  elevationAt: (point: LngLat) => number | undefined,
  spacingMeters = 10,
): TerrainSlope | undefined {
  const sample = (east: number, north: number) => elevationAt(offsetMeters(point, east, north));
  const [e, w, n, s] = [
    sample(spacingMeters, 0),
    sample(-spacingMeters, 0),
    sample(0, spacingMeters),
    sample(0, -spacingMeters),
  ];
  if (e == undefined || w == undefined || n == undefined || s == undefined) {
    return undefined;
  }
  const dzdx = (e - w) / (2 * spacingMeters);
  const dzdy = (n - s) / (2 * spacingMeters);
  return {
    slopeDegrees: (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI,
    // Downhill is against the gradient.
    aspectDegrees: ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360,
  };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function compassDirection(degrees: number): string {
  return COMPASS[Math.round(degrees / 45) % 8]!;
}
