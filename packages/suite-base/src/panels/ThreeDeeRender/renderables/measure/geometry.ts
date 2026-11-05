// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { AnyFrameId, makePose, TransformTree } from "../../transforms";

export type MeasureKind =
  | "point"
  | "distance"
  | "polyline"
  | "angle"
  | "area"
  | "height"
  | "profile";

/** How many points each kind needs; reaching `max` finishes the measurement automatically */
export const KIND_POINTS: Record<MeasureKind, { min: number; max: number }> = {
  point: { min: 1, max: 1 },
  distance: { min: 2, max: 2 },
  polyline: { min: 2, max: Infinity },
  angle: { min: 3, max: 3 },
  area: { min: 3, max: Infinity },
  height: { min: 2, max: 2 },
  profile: { min: 2, max: Infinity },
};

export type ProfileSeries = { x: number[]; z: number[] };

export type MeasureSummary = {
  /** Main value, shown next to the measurement in the scene */
  label: string;
  /** One label per drawn segment (polyline/area), empty otherwise */
  segmentLabels: string[];
  /** Extra lines for the list and clipboard */
  details: string[];
  profile?: ProfileSeries;
};

const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();
const tempPos = new THREE.Vector3();
const tempQuat = new THREE.Quaternion();
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
const IDENTITY_POSE = makePose();
const tempPose = makePose();

export function pathLength(
  points: readonly THREE.Vector3[],
  { closed = false }: { closed?: boolean } = {},
): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += points[i - 1]!.distanceTo(points[i]!);
  }
  if (closed && points.length > 2) {
    length += points[points.length - 1]!.distanceTo(points[0]!);
  }
  return length;
}

/** Angle in radians at vertex `b` between rays b→a and b→c; 0 when either ray is degenerate */
export function angleAt(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  tempA.subVectors(a, b);
  tempB.subVectors(c, b);
  if (tempA.lengthSq() === 0 || tempB.lengthSq() === 0) {
    return 0;
  }
  return tempA.angleTo(tempB);
}

/**
 * Area of a 3D polygon (Newell's method). Exact for planar polygons in any orientation; for
 * non-planar ones it is the area of the best-fit projection.
 */
export function polygonArea(points: readonly THREE.Vector3[]): number {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    x += (p.y - q.y) * (p.z + q.z);
    y += (p.z - q.z) * (p.x + q.x);
    z += (p.x - q.x) * (p.y + q.y);
  }
  return 0.5 * Math.hypot(x, y, z);
}

/** Cumulative horizontal (XY) distance vs. height (Z) along an ordered list of samples */
export function profileSeries(samples: readonly THREE.Vector3[]): ProfileSeries {
  const x: number[] = [];
  const z: number[] = [];
  let distance = 0;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i]!;
    if (i > 0) {
      const prev = samples[i - 1]!;
      distance += Math.hypot(p.x - prev.x, p.y - prev.y);
    }
    x.push(distance);
    z.push(p.z);
  }
  return { x, z };
}

export function formatLength(meters: number): string {
  const abs = Math.abs(meters);
  if (abs < 1) {
    return `${(meters * 100).toFixed(1)} cm`;
  }
  if (abs < 1000) {
    return `${meters.toFixed(2)} m`;
  }
  return `${(meters / 1000).toFixed(3)} km`;
}

export function formatArea(squareMeters: number): string {
  return squareMeters < 1e6
    ? `${squareMeters.toFixed(2)} m²`
    : `${(squareMeters / 1e6).toFixed(3)} km²`;
}

export function formatAngle(radians: number): string {
  return `${THREE.MathUtils.radToDeg(radians).toFixed(1)}°`;
}

export function formatPoint(p: THREE.Vector3): string {
  return `${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}`;
}

function segmentLabels(
  points: readonly THREE.Vector3[],
  { closed }: { closed: boolean },
): string[] {
  const labels: string[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    labels.push(formatLength(points[i]!.distanceTo(points[(i + 1) % points.length]!)));
  }
  return labels;
}

/**
 * Compute the displayed values of a measurement. `points` (and `profileSamples`) must already be
 * expressed in the result frame, since heights and coordinates depend on it.
 */
export function summarize(
  kind: MeasureKind,
  points: readonly THREE.Vector3[],
  profileSamples: readonly THREE.Vector3[] = points,
): MeasureSummary {
  const summary: MeasureSummary = { label: "", segmentLabels: [], details: [] };
  const [a, b, c] = points;
  if (!a) {
    return summary;
  }
  summary.details = points.map((p, i) => `P${i + 1}: ${formatPoint(p)}`);
  switch (kind) {
    case "point":
      summary.label = formatPoint(a);
      break;
    case "distance":
      if (b) {
        summary.label = formatLength(a.distanceTo(b));
        summary.details.push(
          `Δx ${formatLength(b.x - a.x)}, Δy ${formatLength(b.y - a.y)}, Δz ${formatLength(b.z - a.z)}`,
          `Horizontal: ${formatLength(Math.hypot(b.x - a.x, b.y - a.y))}`,
        );
      }
      break;
    case "polyline":
      if (b) {
        summary.label = formatLength(pathLength(points));
        summary.segmentLabels = segmentLabels(points, { closed: false });
      }
      break;
    case "angle":
      if (b && c) {
        summary.label = formatAngle(angleAt(a, b, c));
      }
      break;
    case "area":
      if (points.length >= 3) {
        summary.label = formatArea(polygonArea(points));
        summary.segmentLabels = segmentLabels(points, { closed: true });
        summary.details.push(`Perimeter: ${formatLength(pathLength(points, { closed: true }))}`);
      } else if (b) {
        summary.segmentLabels = segmentLabels(points, { closed: false });
      }
      break;
    case "height":
      if (b) {
        const horizontal = Math.hypot(b.x - a.x, b.y - a.y);
        summary.label = `Δz ${formatLength(b.z - a.z)}`;
        summary.details.push(
          `Horizontal: ${formatLength(horizontal)}`,
          `Slope: ${formatAngle(Math.atan2(Math.abs(b.z - a.z), horizontal))}`,
        );
      }
      break;
    case "profile":
      if (b) {
        const profile = profileSeries(profileSamples);
        const minZ = Math.min(...profile.z);
        const maxZ = Math.max(...profile.z);
        summary.label = formatLength(pathLength(points));
        summary.profile = profile;
        summary.details.push(
          `Min z: ${formatLength(minZ)}, max z: ${formatLength(maxZ)}, Δz ${formatLength(maxZ - minZ)}`,
        );
      }
      break;
  }
  return summary;
}

/**
 * Write the transform that maps points from `srcFrameId` into `dstFrameId` at `time` into `out`.
 * Returns false when the frames are not connected.
 */
export function frameTransform(
  out: THREE.Matrix4,
  tree: TransformTree,
  dstFrameId: AnyFrameId,
  fixedFrameId: AnyFrameId | undefined,
  srcFrameId: AnyFrameId,
  time: bigint,
): boolean {
  if (!tree.apply(tempPose, IDENTITY_POSE, dstFrameId, fixedFrameId, srcFrameId, time, time)) {
    return false;
  }
  const { position: p, orientation: q } = tempPose;
  out.compose(tempPos.set(p.x, p.y, p.z), tempQuat.set(q.x, q.y, q.z, q.w), UNIT_SCALE);
  return true;
}
