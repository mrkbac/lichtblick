// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Manual transform adjustments ("offsets") shared by all 3D and Image panels of a layout.
 *
 * An offset sits on top of the recorded transform, exactly like CoordinateFrame applies it:
 *   position = recorded.position + offset.xyz      (parent axes, meters)
 *   rotation = recorded.rotation * R(offset.rpy)   (frame's own axes, intrinsic XYZ degrees)
 */

import * as THREE from "three";

export type Vec3 = [number, number, number];
/** [x, y, z, w] */
export type Quat = [number, number, number, number];

export type FrameOffset = { xyz: Vec3; rpy: Vec3 };
export type TransformOffsets = {
  /** Render recorded transforms only, ignoring all offsets (A/B comparison) */
  showOriginal?: boolean;
  frames: Record<string, FrameOffset>;
};

/** Layout variable holding {@link TransformOffsets}, so every panel sees the same adjustments */
export const TRANSFORM_OFFSETS_VARIABLE = "transformOffsets";

export const EMPTY_OFFSETS: TransformOffsets = { frames: {} };

export type AdjustStep = "fine" | "medium" | "coarse";
export const ADJUST_STEPS: Record<AdjustStep, { meters: number; degrees: number }> = {
  fine: { meters: 0.001, degrees: 0.01 },
  medium: { meters: 0.01, degrees: 0.1 },
  coarse: { meters: 0.1, degrees: 1 },
};

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const tempEuler = new THREE.Euler();
const tempQuatA = new THREE.Quaternion();
const tempQuatB = new THREE.Quaternion();

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((v) => Number.isFinite(v));
}

/** Clean up float noise from composing rotations, e.g. 0.9999999999 -> 1, and -0 -> 0 */
function clean(value: number): number {
  return Math.round(value * 1e9) / 1e9 + 0; // + 0 turns -0 into 0
}

export function isZeroVec3(v: Readonly<Vec3>): boolean {
  return v[0] === 0 && v[1] === 0 && v[2] === 0;
}

/** Validate a layout variable value; anything malformed is dropped */
export function parseTransformOffsets(value: unknown): TransformOffsets {
  if (value == undefined || typeof value !== "object" || Array.isArray(value)) {
    return EMPTY_OFFSETS;
  }
  const { showOriginal, frames } = value as Record<string, unknown>;
  const result: TransformOffsets = { frames: {} };
  if (showOriginal === true) {
    result.showOriginal = true;
  }
  if (frames != undefined && typeof frames === "object" && !Array.isArray(frames)) {
    for (const [frameId, offset] of Object.entries(frames as Record<string, unknown>)) {
      const { xyz, rpy } = (offset ?? {}) as Record<string, unknown>;
      if (isVec3(xyz) && isVec3(rpy)) {
        result.frames[frameId] = { xyz: [...xyz], rpy: [...rpy] };
      }
    }
  }
  return result;
}

/** Return new offsets with `frameId` set, removing it when the offset is zero */
export function withFrameOffset(
  offsets: TransformOffsets,
  frameId: string,
  offset: FrameOffset | undefined,
): TransformOffsets {
  const frames = { ...offsets.frames };
  if (offset == undefined || (isZeroVec3(offset.xyz) && isZeroVec3(offset.rpy))) {
    delete frames[frameId];
  } else {
    frames[frameId] = {
      xyz: offset.xyz.map(clean) as Vec3,
      rpy: offset.rpy.map(clean) as Vec3,
    };
  }
  return { ...offsets, frames };
}

export function rpyDegreesToQuat(rpy: Readonly<Vec3>): Quat {
  tempEuler.set(rpy[0] * DEG2RAD, rpy[1] * DEG2RAD, rpy[2] * DEG2RAD, "XYZ");
  return tempQuatA.setFromEuler(tempEuler).toArray();
}

/** Intrinsic XYZ Euler angles in degrees, the convention used throughout the transforms settings */
export function quatToRpyDegrees(q: Readonly<Quat>): Vec3 {
  tempEuler.setFromQuaternion(tempQuatA.fromArray(q), "XYZ");
  return [tempEuler.x * RAD2DEG, tempEuler.y * RAD2DEG, tempEuler.z * RAD2DEG];
}

/** The transform that is actually rendered: recorded transform with the offset applied */
export function applyOffset(
  position: Readonly<Vec3>,
  rotation: Readonly<Quat>,
  offset: FrameOffset | undefined,
): { position: Vec3; rotation: Quat } {
  if (!offset) {
    return { position: [...position], rotation: [...rotation] };
  }
  tempQuatB.fromArray(rpyDegreesToQuat(offset.rpy)); // uses tempQuatA, so call it first
  tempQuatA.fromArray(rotation);
  return {
    position: [
      position[0] + offset.xyz[0],
      position[1] + offset.xyz[1],
      position[2] + offset.xyz[2],
    ],
    rotation: tempQuatA.multiply(tempQuatB).toArray(),
  };
}

/** Offset needed so the rendered transform equals the given result (inverse of applyOffset) */
export function offsetForResult(
  position: Readonly<Vec3>,
  rotation: Readonly<Quat>,
  resultXyz: Readonly<Vec3>,
  resultRpy: Readonly<Vec3>,
): FrameOffset {
  const target = rpyDegreesToQuat(resultRpy);
  tempQuatB.fromArray(rotation).invert().multiply(tempQuatA.fromArray(target));
  return {
    xyz: [resultXyz[0] - position[0], resultXyz[1] - position[1], resultXyz[2] - position[2]],
    rpy: quatToRpyDegrees(tempQuatB.toArray()),
  };
}

export type NudgeKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "PageUp" | "PageDown";

/**
 * Keyboard nudge of translation and roll/pitch/yaw values (the keyboard nudges the result).
 * Arrows move X (up/down) and Y (left/right), PageUp/PageDown move Z.
 * With `rotate`, the same keys change pitch, yaw and roll.
 */
export function nudge(
  values: FrameOffset | undefined,
  key: NudgeKey,
  { rotate, amount }: { rotate: boolean; amount: number },
): FrameOffset {
  const next: FrameOffset = {
    xyz: [...(values?.xyz ?? [0, 0, 0])],
    rpy: [...(values?.rpy ?? [0, 0, 0])],
  };
  const [axis, sign] = {
    ArrowUp: [rotate ? 1 : 0, 1],
    ArrowDown: [rotate ? 1 : 0, -1],
    ArrowLeft: [rotate ? 2 : 1, 1],
    ArrowRight: [rotate ? 2 : 1, -1],
    PageUp: [rotate ? 0 : 2, 1],
    PageDown: [rotate ? 0 : 2, -1],
  }[key] as [0 | 1 | 2, number];
  (rotate ? next.rpy : next.xyz)[axis] += sign * amount;
  return next;
}

const fmt = (v: number) => String(clean(Number(v.toFixed(6))));
// Frame ids come from recordings: escape them for each output format
const xmlAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const shellQuote = (s: string) => (/^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);
const yamlString = (s: string) => JSON.stringify(s);

/** URDF fixed joint; URDF `rpy` is extrinsic XYZ (= intrinsic ZYX) in radians */
export function formatUrdfJoint(
  parent: string,
  child: string,
  position: Vec3,
  rotation: Quat,
): string {
  tempEuler.setFromQuaternion(tempQuatA.fromArray(rotation), "ZYX");
  const rpy = [tempEuler.x, tempEuler.y, tempEuler.z];
  return [
    `<joint name="${xmlAttr(`${parent}_to_${child}`)}" type="fixed">`,
    `  <parent link="${xmlAttr(parent)}"/>`,
    `  <child link="${xmlAttr(child)}"/>`,
    `  <origin xyz="${position.map(fmt).join(" ")}" rpy="${rpy.map(fmt).join(" ")}"/>`,
    `</joint>`,
  ].join("\n");
}

export function formatStaticTransformPublisher(
  parent: string,
  child: string,
  position: Vec3,
  rotation: Quat,
): string {
  const [x, y, z] = position.map(fmt);
  const [qx, qy, qz, qw] = rotation.map(fmt);
  return (
    `ros2 run tf2_ros static_transform_publisher --x ${x} --y ${y} --z ${z}` +
    ` --qx ${qx} --qy ${qy} --qz ${qz} --qw ${qw}` +
    ` --frame-id ${shellQuote(parent)} --child-frame-id ${shellQuote(child)}`
  );
}

/** geometry_msgs/TransformStamped-like YAML, plus the Euler angles shown in the settings */
export function formatYaml(parent: string, child: string, position: Vec3, rotation: Quat): string {
  const [x, y, z] = position.map(fmt);
  const [qx, qy, qz, qw] = rotation.map(fmt);
  const [r, p, yaw] = quatToRpyDegrees(rotation).map(fmt);
  return [
    `parent_frame: ${yamlString(parent)}`,
    `child_frame: ${yamlString(child)}`,
    `translation: {x: ${x}, y: ${y}, z: ${z}}`,
    `rotation: {x: ${qx}, y: ${qy}, z: ${qz}, w: ${qw}}`,
    `# intrinsic XYZ Euler angles, degrees`,
    `rotation_euler_xyz_deg: [${r}, ${p}, ${yaw}]`,
  ].join("\n");
}
