// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three/webgpu";

import { Picker, decodePick } from "./Picker";

function floatBits(value: number): number {
  return new Uint32Array(new Float32Array([value]).buffer)[0]!;
}

describe("decodePick", () => {
  it("reads nothing from a cleared pixel", () => {
    expect(decodePick([0, 0, 0, 0])).toBeUndefined();
  });

  it("reads object, instance and view depth", () => {
    expect(decodePick([42, 7, floatBits(12.5), 1])).toEqual({
      objectId: 42,
      instanceIndex: 7,
      viewDepth: 12.5,
    });
  });

  it("reads objects without instances", () => {
    expect(decodePick([0, 0xffffffff, floatBits(3), 1])).toEqual({
      objectId: 0,
      instanceIndex: undefined,
      viewDepth: 3,
    });
  });
});

describe("Picker", () => {
  it("keeps the pixel crop when a camera is first rendered with WebGPU", async () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    let drawnProjection: THREE.Matrix4 | undefined;
    const renderer = {
      coordinateSystem: THREE.WebGPUCoordinateSystem,
      domElement: { width: 4, height: 4 },
      getPixelRatio: () => 1,
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      getRenderObjectFunction: () => null,
      setRenderObjectFunction: () => {},
      getClearAlpha: () => 1,
      getClearColor: () => {},
      setClearColor: () => {},
      clear: () => {},
      // What three's render() does to a camera it hasn't drawn yet
      render: (_scene: THREE.Scene, drawn: THREE.OrthographicCamera) => {
        if (drawn.coordinateSystem !== THREE.WebGPUCoordinateSystem) {
          drawn.coordinateSystem = THREE.WebGPUCoordinateSystem;
          drawn.updateProjectionMatrix();
        }
        drawnProjection = drawn.projectionMatrix.clone();
      },
      readRenderTargetPixelsAsync: async () => new Uint32Array(4),
    };
    const picker = new Picker(renderer as unknown as THREE.WebGPURenderer, new THREE.Scene());

    await picker.pick(1, 1, camera);

    const crop = new THREE.Matrix4().makeScale(4, 4, 1);
    crop.elements[12] = 1;
    crop.elements[13] = -1;
    expect(camera.coordinateSystem).toBe(THREE.WebGPUCoordinateSystem);
    expect(drawnProjection?.elements).toEqual(crop.multiply(camera.projectionMatrix).elements);
  });
});
