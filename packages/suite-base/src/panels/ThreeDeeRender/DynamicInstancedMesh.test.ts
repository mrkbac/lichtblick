// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { DynamicInstancedMesh } from "./DynamicInstancedMesh";

describe("DynamicInstancedMesh", () => {
  it("keeps instance colors as floats, which WebGPU has a vertex format for, through growth", () => {
    const mesh = new DynamicInstancedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
      1,
    );
    const points = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0, z: 0 }));
    const colors = points.map(() => ({ r: 0.25, g: 0.5, b: 1, a: 1 }));

    mesh.set(points, { x: 1, y: 1, z: 1 }, colors, { r: 0, g: 0, b: 0, a: 1 });

    expect(mesh.count).toBe(10);
    // A 3-component 8-bit attribute (e.g. Uint8ClampedArray) has no WebGPU vertex format
    expect(mesh.instanceColor!.array).toBeInstanceOf(Float32Array);
    expect(Array.from(mesh.instanceColor!.array.slice(27, 30))).toEqual([0.25, 0.5, 1]);
  });
});
