// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import * as urdf from "@lichtblick/den/urdf";
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
    "keeps URDF colors for plain OBJ models (warning: %s)",
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
  function createExtension(fetchAsset: IRenderer["fetchAsset"]) {
    const addError = vi.fn();
    const queueAnimationFrame = vi.fn();
    const extension = new Urdfs({
      ...renderer,
      queueAnimationFrame,
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
      fetchAsset,
    } as unknown as IRenderer);
    return { extension, addError, queueAnimationFrame };
  }

  it.each(["success", "failure"])("ignores a superseded fetch %s", async (result) => {
    // Given
    const request = Promise.withResolvers<{ uri: string; data: Uint8Array }>();
    const { extension, addError } = createExtension(async () => await request.promise);
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
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    // Then
    expect(renderable.userData.urdf).toBe("new selection");
    expect(addError).not.toHaveBeenCalled();
    extension.dispose();
  });
  it.each(["success", "failure"])(
    "ignores an identical-content parse %s after reloading",
    async (result) => {
      // Given
      const previous = Promise.withResolvers<UrdfRobot>();
      const current = Promise.withResolvers<UrdfRobot>();
      const parse = vi
        .spyOn(urdf, "parseRobot")
        .mockImplementationOnce(async () => await previous.promise)
        .mockImplementation(async () => await current.promise);
      const { extension, addError, queueAnimationFrame } = createExtension(async (uri) => ({
        uri,
        data: new TextEncoder().encode("same URDF"),
      }));
      await vi.waitFor(() => {
        expect(parse).toHaveBeenCalledTimes(1);
      });
      // When
      const layer = extension
        .settingsNodes()
        .find((entry) => entry.path[0] === "layers" && entry.path[1] === "robot")!;
      layer.node.handler!({
        action: "update",
        payload: { path: ["layers", "robot", "displayMode"], input: "select", value: "visual" },
      });
      await vi.waitFor(() => {
        expect(parse).toHaveBeenCalledTimes(2);
      });
      queueAnimationFrame.mockClear();
      addError.mockClear();
      if (result === "success") {
        previous.resolve(robot);
      } else {
        previous.reject(new Error("previous parse failed"));
      }
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      // Then
      expect(queueAnimationFrame).not.toHaveBeenCalled();
      expect(addError).not.toHaveBeenCalled();
      parse.mockRestore();
      extension.dispose();
    },
  );
});
