// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { quatToEuler } from "./quatToEuler";

describe("quatToEuler", () => {
  it("matches THREE.Euler XYZ, including gimbal lock", () => {
    const quats: [number, number, number, number][] = [
      [0, 0, 0, 1],
      [0.1, 0.2, 0.3, 0.927],
      [-0.5, 0.5, -0.5, 0.5],
      [0, Math.SQRT1_2, 0, Math.SQRT1_2], // pitch = 90°
      [0.3, -0.7, 0.2, 0.6],
    ];
    for (const [x, y, z, w] of quats) {
      const q = new THREE.Quaternion(x, y, z, w).normalize();
      const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
      const expected = [e.x, e.y, e.z].map(THREE.MathUtils.radToDeg);
      const actual = quatToEuler(q.x, q.y, q.z, q.w);
      actual.forEach((v, i) => {
        expect(v).toBeCloseTo(expected[i]!, 6);
      });
    }
  });
});
