// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const RAD2DEG = 180 / Math.PI;

/**
 * Convert a quaternion to roll-pitch-yaw Euler angles (intrinsic XYZ, degrees).
 *
 * Same math as THREE.Euler.setFromQuaternion(q, "XYZ"), without importing three into the startup
 * bundle (getItemString runs in Raw Messages and tooltips).
 */
export function quatToEuler(
  x: number,
  y: number,
  z: number,
  w: number,
): [roll: number, pitch: number, yaw: number] {
  // Rotation matrix elements, as in THREE.Matrix4.makeRotationFromQuaternion
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - w * z);
  const m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - w * x);
  const m32 = 2 * (y * z + w * x);
  const m33 = 1 - 2 * (x * x + y * y);

  const pitch = Math.asin(Math.max(-1, Math.min(1, m13)));
  const gimbalLock = Math.abs(m13) >= 0.9999999;
  const roll = gimbalLock ? Math.atan2(m32, m22) : Math.atan2(-m23, m33);
  const yaw = gimbalLock ? 0 : Math.atan2(-m12, m11);
  return [roll * RAD2DEG, pitch * RAD2DEG, yaw * RAD2DEG];
}
