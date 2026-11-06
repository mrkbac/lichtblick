// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Frame-to-frame measurement shared by the 3D and Transform Tree panels of a layout: the pose of
 * the "to" frame expressed in the "from" frame.
 */

import * as THREE from "three";

import { Quat, quatToEulerDegrees, RotationConvention, Vec3 } from "./transformOffsets";

/** Layout variable holding {@link FrameMeasurement}, so every panel shows the same pair */
export const FRAME_MEASUREMENT_VARIABLE = "frameMeasurement";

export type RotationFormat = "degrees" | "radians" | "quaternion";
export const ROTATION_FORMATS: readonly RotationFormat[] = ["degrees", "radians", "quaternion"];

export type FrameMeasurement = {
  from?: string;
  to?: string;
  rotationFormat?: RotationFormat;
  /** Euler convention of roll/pitch/yaw; shared so every panel shows the same numbers */
  convention?: RotationConvention;
};

/** ROS convention (tf2 getRPY, URDF rpy) */
export const DEFAULT_MEASURE_CONVENTION: RotationConvention = "extrinsic";

export type Pose = { position: Vec3; rotation: Quat };

/** Why a measurement has no values: a frame without a transform, or two unconnected trees */
export type MissingLink = { frame: string } | { between: [string, string] };

export function parseFrameMeasurement(value: unknown): FrameMeasurement {
  if (value == undefined || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const { from, to, rotationFormat, convention } = value as Record<string, unknown>;
  const result: FrameMeasurement = {};
  if (typeof from === "string" && from !== "") {
    result.from = from;
  }
  if (typeof to === "string" && to !== "") {
    result.to = to;
  }
  if (ROTATION_FORMATS.includes(rotationFormat as RotationFormat)) {
    result.rotationFormat = rotationFormat as RotationFormat;
  }
  if (convention === "extrinsic" || convention === "intrinsic") {
    result.convention = convention;
  }
  return result;
}

/** A click on a frame: fills From, then To; a click after both are set starts over */
export function pickFrame(measurement: FrameMeasurement, frame: string): FrameMeasurement {
  const { from, to, ...rest } = measurement;
  if (from == undefined || (to != undefined && frame !== to)) {
    return { ...rest, from: frame };
  }
  if (to == undefined) {
    return frame === from ? measurement : { ...rest, from, to: frame };
  }
  return measurement;
}

/** Set one end; picking the other end's frame swaps them instead of measuring a frame to itself */
export function setEnd(
  measurement: FrameMeasurement,
  end: "from" | "to",
  frame: string | undefined,
): FrameMeasurement {
  const other = end === "from" ? "to" : "from";
  const next: FrameMeasurement = { ...measurement, [end]: frame };
  if (frame != undefined && measurement[other] === frame) {
    next[other] = measurement[end];
  }
  return parseFrameMeasurement(next);
}

export function swapFrames({ from, to, ...rest }: FrameMeasurement): FrameMeasurement {
  return parseFrameMeasurement({ ...rest, from: to, to: from });
}

/** Clear the pair but keep the preferred rotation format and convention */
export function clearFrames({ from: _from, to: _to, ...rest }: FrameMeasurement): FrameMeasurement {
  return rest;
}

/**
 * Find what disconnects `from` and `to` in a tree given by each frame's parent, or undefined when
 * they share a root. `hasFrame` says whether a frame has a transform (or is a known root) now.
 */
export function findMissingLink(
  from: string,
  to: string,
  parentOf: (frame: string) => string | undefined,
  hasFrame: (frame: string) => boolean,
): MissingLink | undefined {
  for (const frame of [from, to]) {
    if (!hasFrame(frame)) {
      return { frame };
    }
  }
  const rootOf = (frame: string) => {
    const seen = new Set<string>();
    let current = frame;
    let parent = parentOf(current);
    // Guard against cycles from conflicting parents
    while (parent != undefined && !seen.has(parent)) {
      seen.add(current);
      current = parent;
      parent = parentOf(current);
    }
    return current;
  };
  const fromRoot = rootOf(from);
  const toRoot = rootOf(to);
  return fromRoot === toRoot ? undefined : { between: [fromRoot, toRoot] };
}

const tempMatA = new THREE.Matrix4();
const tempMatB = new THREE.Matrix4();
const tempPos = new THREE.Vector3();
const tempQuat = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const UNIT = new THREE.Vector3(1, 1, 1);

function toMatrix(out: THREE.Matrix4, { position, rotation }: Pose): THREE.Matrix4 {
  // Recorded quaternions are often slightly off unit length, which would skew the result
  return out.compose(tempPos.fromArray(position), tempQuat.fromArray(rotation).normalize(), UNIT);
}

function fromMatrix(matrix: THREE.Matrix4): Pose {
  matrix.decompose(tempPos, tempQuat, tempScale);
  return { position: tempPos.toArray(), rotation: tempQuat.toArray() };
}

/** Compose parent->child transforms, root first: the pose of the last child in the root */
export function composePoses(chain: readonly Pose[]): Pose {
  tempMatA.identity();
  for (const pose of chain) {
    tempMatA.multiply(toMatrix(tempMatB, pose));
  }
  return fromMatrix(tempMatA);
}

/** Pose of `to` expressed in `from`, given both poses in a common root */
export function relativePose(fromInRoot: Pose, toInRoot: Pose): Pose {
  toMatrix(tempMatA, fromInRoot).invert();
  return fromMatrix(tempMatA.multiply(toMatrix(tempMatB, toInRoot)));
}

export function distance({ position: [x, y, z] }: Pose): number {
  return Math.hypot(x, y, z);
}

/** No "-0.000" */
export function formatNumber(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

export type FormattedRotation = { labels: string[]; values: string[]; unit: string };

/** Rotation in the chosen format; roll/pitch/yaw use the panel's Euler convention */
export function formatRotation(
  rotation: Quat,
  format: RotationFormat,
  convention: RotationConvention,
): FormattedRotation {
  if (format === "quaternion") {
    return {
      labels: ["x", "y", "z", "w"],
      values: rotation.map((v) => formatNumber(v, 4)),
      unit: "",
    };
  }
  const degrees = quatToEulerDegrees(rotation, convention);
  return format === "degrees"
    ? {
        labels: ["roll", "pitch", "yaw"],
        values: degrees.map((v) => formatNumber(v, 2)),
        unit: "°",
      }
    : {
        labels: ["roll", "pitch", "yaw"],
        values: degrees.map((v) => formatNumber((v * Math.PI) / 180, 4)),
        unit: "rad",
      };
}

/** Plain text for the clipboard */
export function formatMeasurementText(
  from: string,
  to: string,
  pose: Pose,
  format: RotationFormat,
  convention: RotationConvention,
): string {
  const rotation = formatRotation(pose.rotation, format, convention);
  const rotationName =
    format === "quaternion" ? "quaternion (xyzw)" : `rpy ${convention} (${rotation.unit})`;
  return [
    `${to} in ${from}`,
    `distance: ${formatNumber(distance(pose), 4)} m`,
    `translation (m): ${pose.position.map((v) => formatNumber(v, 4)).join(", ")}`,
    `${rotationName}: ${rotation.values.join(", ")}`,
  ].join("\n");
}
