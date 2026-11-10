// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { UrdfRobot } from "@lichtblick/den/urdf";

import { createRenderable, Urdfs } from "./Urdfs";
import { IRenderer } from "../IRenderer";
import { LoadedModel } from "../ModelCache";
import { RenderableMeshResource } from "./markers/RenderableMeshResource";

vi.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => ({ default: "" }));

const meshErrors = { add: vi.fn(), remove: vi.fn() };
const renderer = {
  normalizeFrameId: (id: string) => id,
  queueAnimationFrame: vi.fn(),
  settings: { errors: meshErrors },
  config: { topics: {} },
  modelCache: { load: async () => await new Promise(() => {}) },
} as unknown as IRenderer;

const robot: UrdfRobot = {
  name: "robot",
  links: new Map(),
  joints: new Map(),
  materials: new Map(),
};

describe("Urdfs createRenderable", () => {
  it.each([false, true])(
    "keeps the URDF color for OBJ models without material libraries (warning: %s)",
    async (warning) => {
      // Given
      const cachedModel: LoadedModel = new THREE.Group();
      cachedModel.hasEmbeddedMaterials = false;
      cachedModel.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
      const load = vi
        .spyOn(renderer.modelCache, "load")
        .mockImplementation(async (_url, _opts, reportError) => {
          if (warning) {
            reportError(new Error("Missing optional material library"));
          }
          return cachedModel;
        });
      // When
      const renderable = createRenderable({
        visual: {
          geometry: { geometryType: "mesh", filename: "file:///plain.obj" },
          material: { color: { r: 1, g: 0, b: 0, a: 1 } },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
        },
        robot,
        id: 0,
        frameId: "base_link",
        renderer,
      }) as RenderableMeshResource;
      await vi.waitFor(() => {
        expect(renderable.children).toHaveLength(1);
      });
      // Then
      const mesh = renderable.children[0]!.children[0] as THREE.Mesh;
      expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xff0000);
      const added = meshErrors.add.mock.invocationCallOrder.at(-1) ?? 0;
      const removed = meshErrors.remove.mock.invocationCallOrder.at(-1) ?? 0;
      expect(added > removed).toBe(warning);
      load.mockRestore();
      renderable.dispose();
    },
  );

  it.each([
    ["mesh.glb", true],
    ["mesh.GLTF", true],
    ["mesh.dae", true],
    ["mesh.glb?token=abc", true],
    ["mesh.stl?v=glb", false],
    ["mesh.stl?preview=robot.glb#view", false],
    ["mesh.stl", false],
    ["mesh.obj", true],
  ])("uses embedded materials for %s: %s", (filename, expected) => {
    const renderable = createRenderable({
      visual: {
        geometry: { geometryType: "mesh", filename: `file:///${filename}` },
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
      },
      robot,
      id: 0,
      frameId: "base_link",
      renderer,
    }) as RenderableMeshResource;
    expect(renderable.userData.marker.mesh_use_embedded_materials).toBe(expected);
  });
});

describe("URDF requests", () => {
  it.each(["success", "failure"])("ignores a superseded fetch %s", async (result) => {
    // Given
    const request = Promise.withResolvers<{ uri: string; data: Uint8Array }>();
    const addError = vi.fn();
    const extension = new Urdfs({
      ...renderer,
      config: {
        topics: {},
        layers: {
          robot: {
            layerId: "foxglove.Urdf",
            sourceType: "url",
            url: "https://example.com/old.urdf",
            label: "URDF",
          },
        },
      },
      on: vi.fn(),
      addCustomLayerAction: vi.fn(),
      updateConfig: vi.fn(),
      settings: { errors: { add: addError, remove: vi.fn() }, setNodesForKey: vi.fn() },
      fetchAsset: async () => await request.promise,
    } as unknown as IRenderer);
    const renderable = extension.renderables.get("robot")!;
    renderable.userData.fetching = undefined;
    renderable.userData.urdf = "new selection";
    addError.mockClear();
    // When
    if (result === "success") {
      request.resolve({
        uri: "https://example.com/old.urdf",
        data: new TextEncoder().encode("old response"),
      });
    } else {
      request.reject(new Error("old failure"));
    }
    await request.promise.catch(() => {});
    await Promise.resolve();
    await Promise.resolve();
    // Then
    expect(renderable.userData.urdf).toBe("new selection");
    expect(addError).not.toHaveBeenCalled();
    extension.dispose();
  });
});
