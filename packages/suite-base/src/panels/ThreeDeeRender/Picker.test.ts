// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three/webgpu";

import { Picker, decodePick, derivePickMaterial } from "./Picker";

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
  it("refreshes matrices and keeps the crop when first picking with WebGPU", async () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    const scene = new THREE.Scene();
    scene.matrixWorldAutoUpdate = false;
    const object = new THREE.Object3D();
    scene.add(object);
    object.position.x = 5;
    camera.position.z = 7;
    const prepare = vi.fn(() => {
      expect(object.matrixWorld.elements[12]).toBe(5);
      expect(camera.matrixWorld.elements[14]).toBe(7);
    });
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
    const picker = new Picker(renderer as unknown as THREE.WebGPURenderer, scene, prepare);

    await picker.pick(1, 1, camera);

    const crop = new THREE.Matrix4().makeScale(4, 4, 1);
    crop.elements[12] = 1;
    crop.elements[13] = -1;
    expect(prepare).toHaveBeenCalledOnce();
    expect(camera.coordinateSystem).toBe(THREE.WebGPUCoordinateSystem);
    expect(drawnProjection?.elements).toEqual(crop.multiply(camera.projectionMatrix).elements);
  });
});

describe("derivePickMaterial", () => {
  it("writes depth for translucent sources, but not for ones without depth test", () => {
    const translucent = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    expect(derivePickMaterial(translucent, { instanced: false }).depthWrite).toBe(true);
    // Drawn behind (e.g. grids): must not hide objects drawn after it
    const behind = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    expect(derivePickMaterial(behind, { instanced: false }).depthWrite).toBe(false);
  });
});

type RenderObject = (
  object: THREE.Object3D,
  scene: THREE.Scene,
  camera: THREE.Camera,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
) => void;

describe("Picker source materials", () => {
  function setup() {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial());
    let renderObject: RenderObject | undefined;
    const renderer = {
      coordinateSystem: THREE.WebGPUCoordinateSystem,
      domElement: { width: 4, height: 4 },
      getPixelRatio: () => 1,
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      getRenderObjectFunction: () => null,
      setRenderObjectFunction: (fn: RenderObject | null) => {
        renderObject = fn ?? undefined;
      },
      getClearAlpha: () => 1,
      getClearColor: () => {},
      setClearColor: () => {},
      clear: () => {},
      renderObject: () => {},
      render: (_scene: THREE.Scene, camera: THREE.Camera) => {
        renderObject?.(mesh, scene, camera, mesh.geometry, mesh.material);
      },
      readRenderTargetPixelsAsync: async () => new Uint32Array(4),
    };
    const picker = new Picker(renderer as unknown as THREE.WebGPURenderer, scene);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    // Dispose listeners currently registered on the source material
    const listeners = new Set<unknown>();
    const material = mesh.material;
    const add = material.addEventListener.bind(material);
    const remove = material.removeEventListener.bind(material);
    vi.spyOn(material, "addEventListener").mockImplementation((type, listener) => {
      listeners.add(listener);
      add(type, listener);
    });
    vi.spyOn(material, "removeEventListener").mockImplementation((type, listener) => {
      listeners.delete(listener);
      remove(type, listener);
    });
    return { picker, camera, material, listenerCount: () => listeners.size };
  }

  it("stops listening to a source once it is disposed and picked again", async () => {
    const { picker, camera, material, listenerCount } = setup();
    await picker.pick(1, 1, camera);
    expect(listenerCount()).toBe(1);
    material.dispose();
    expect(listenerCount()).toBe(0);
    await picker.pick(1, 1, camera);
    expect(listenerCount()).toBe(1);
  });

  it("removes its listeners when disposed", async () => {
    const { picker, camera, listenerCount } = setup();
    await picker.pick(1, 1, camera);
    picker.dispose();
    expect(listenerCount()).toBe(0);
  });
});
