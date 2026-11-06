// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { UrdfRobot } from "@lichtblick/den/urdf";

import { createRenderable } from "./Urdfs";
import { IRenderer } from "../IRenderer";
import { RenderableMeshResource } from "./markers/RenderableMeshResource";

vi.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => ({ default: "" }));

const renderer = {
  normalizeFrameId: (id: string) => id,
  settings: { errors: { add: vi.fn(), remove: vi.fn() } },
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
  it.each([
    ["mesh.glb", true],
    ["mesh.GLTF", true],
    ["mesh.dae", true],
    ["mesh.glb?token=abc", true],
    ["mesh.stl?v=glb", false],
    ["mesh.stl", false],
    ["mesh.obj", false],
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
