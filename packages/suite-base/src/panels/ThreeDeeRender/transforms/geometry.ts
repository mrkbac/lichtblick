// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { vec3, quat, mat4, ReadonlyMat4 } from "gl-matrix";

export type Point = {
  x: number;
  y: number;
  z: number;
};

export type Orientation = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type Pose = {
  position: Point;
  orientation: Orientation;
};

export function makePose(): Pose {
  return { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
}

export function xyzrpyToPose(xyz: vec3, rpy: vec3): Pose {
  const o = quat.fromEuler([0, 0, 0, 1], rpy[0], rpy[1], rpy[2]);
  return {
    position: { x: xyz[0], y: xyz[1], z: xyz[2] },
    orientation: { x: o[0], y: o[1], z: o[2], w: o[3] },
  };
}

// Helper functions for constructing geometry primitives that can be used with
// gl-matrix. These methods are preferred over the gl-matrix equivalents since
// they produce number[] arrays instead of Float32Array, which have less
// precision and are slower (float32 requires upcasting/downcasting to do math
// in JavaScript).

export function vec3Identity(): vec3 {
  return [0, 0, 0];
}

export function quatIdentity(): quat {
  return [0, 0, 0, 1];
}

export function mat4Identity(): mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/**
 * Returns a quaternion representing the rotational component of a
 * transformation matrix. The matrix must not have any scaling applied to it.
 * @param out Quaternion to receive the rotation component
 * @param mat Matrix to be decomposed (input)
 * @param scaling Scaling of the matrix (input)
 * @return out
 */
export function getRotationNoScaling(out: quat, mat: ReadonlyMat4): quat {
  const m11 = mat[0];
  const m12 = mat[1];
  const m13 = mat[2];
  const m21 = mat[4];
  const m22 = mat[5];
  const m23 = mat[6];
  const m31 = mat[8];
  const m32 = mat[9];
  const m33 = mat[10];
  const trace = m11 + m22 + m33;
  let S = 0;
  if (trace > 0) {
    S = Math.sqrt(trace + 1.0) * 2;
    out[3] = 0.25 * S;
    out[0] = (m23 - m32) / S;
    out[1] = (m31 - m13) / S;
    out[2] = (m12 - m21) / S;
  } else if (m11 > m22 && m11 > m33) {
    S = Math.sqrt(1.0 + m11 - m22 - m33) * 2;
    out[3] = (m23 - m32) / S;
    out[0] = 0.25 * S;
    out[1] = (m12 + m21) / S;
    out[2] = (m31 + m13) / S;
  } else if (m22 > m33) {
    S = Math.sqrt(1.0 + m22 - m11 - m33) * 2;
    out[3] = (m31 - m13) / S;
    out[0] = (m12 + m21) / S;
    out[1] = 0.25 * S;
    out[2] = (m23 + m32) / S;
  } else {
    S = Math.sqrt(1.0 + m33 - m11 - m22) * 2;
    out[3] = (m12 - m21) / S;
    out[0] = (m31 + m13) / S;
    out[1] = (m23 + m32) / S;
    out[2] = 0.25 * S;
  }
  return out;
}
