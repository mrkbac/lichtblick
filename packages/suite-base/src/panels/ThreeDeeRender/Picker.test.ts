// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { Picker } from "./Picker";

describe("Picker projection", () => {
  it.each([false, true])("crops and restores a camera projection (custom=%s)", (custom) => {
    const camera = new THREE.PerspectiveCamera(45, 2, 0.5, 500);
    if (custom) {
      camera.projectionMatrix.elements[8] = 0.2;
      camera.projectionMatrix.elements[10] = -1.003;
    }
    const original = camera.projectionMatrix.clone();
    const renderedProjection = new THREE.Matrix4();
    const gl = {
      domElement: { width: 800, height: 400 },
      getPixelRatio: () => 1,
      getRenderTarget: () => null,
      getClearAlpha: () => 1,
      getClearColor: vi.fn(),
      setRenderTarget: vi.fn(),
      setClearColor: vi.fn(),
      clear: vi.fn(),
      render: vi.fn(() => {
        renderedProjection.copy(camera.projectionMatrix);
      }),
      readRenderTargetPixels: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    const picker = new Picker(gl, new THREE.Scene());
    picker.pick(300, 100, camera);
    const before = new THREE.Vector4(2, 1, -10, 1).applyMatrix4(original);
    const after = new THREE.Vector4(2, 1, -10, 1).applyMatrix4(renderedProjection);
    expect(after.x / after.w).toBeCloseTo(
      ((800 / 31) * before.x) / before.w + (800 - 570 - 31) / 31,
    );
    expect(after.y / after.w).toBeCloseTo(
      ((400 / 31) * before.y) / before.w + (170 + 31 - 400) / 31,
    );
    expect(after.z / after.w).toBeCloseTo(before.z / before.w);
    expect(camera.projectionMatrix.equals(original)).toBe(true);
    expect(camera.projectionMatrixInverse.equals(original.clone().invert())).toBe(true);
    picker.dispose();
  });
});
