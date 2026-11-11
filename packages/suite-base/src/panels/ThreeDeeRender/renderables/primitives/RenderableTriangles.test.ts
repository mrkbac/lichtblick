// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { SceneEntity, TriangleListPrimitive } from "@foxglove/schemas";
import * as THREE from "three";

import { RenderableTriangles } from "./RenderableTriangles";
import type { Renderer } from "../../Renderer";
import { LayerSettingsEntity } from "../../settings";

const settings: LayerSettingsEntity = {
  visible: true,
  showOutlines: true,
  color: undefined,
  selectedIdVariable: undefined,
};

function entity(triangle: Partial<TriangleListPrimitive>): SceneEntity {
  return {
    timestamp: { sec: 0, nsec: 0 },
    frame_id: "frame",
    id: "id",
    lifetime: { sec: 0, nsec: 0 },
    frame_locked: false,
    metadata: [],
    arrows: [],
    cubes: [],
    spheres: [],
    cylinders: [],
    lines: [],
    triangles: [
      {
        pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
        color: { r: 1, g: 0, b: 0, a: 1 },
        colors: [],
        indices: [],
        ...triangle,
      },
    ],
    texts: [],
    models: [],
  };
}

function materialVersion(renderable: RenderableTriangles): number {
  let version = 0;
  renderable.traverse((object) => {
    const material = (object as Partial<THREE.Mesh>).material as THREE.Material | undefined;
    version += material?.version ?? 0;
  });
  return version;
}

describe("RenderableTriangles", () => {
  it("does not rebuild the shader for a color change", () => {
    const renderable = new RenderableTriangles({} as Renderer);
    renderable.update("/topic", entity({}), settings, 0n);
    const initial = materialVersion(renderable);

    for (let i = 1; i <= 10; i++) {
      renderable.update("/topic", entity({ color: { r: i / 10, g: 0, b: 0, a: 1 } }), settings, 0n);
    }
    expect(materialVersion(renderable)).toBe(initial);

    // Switching between vertex colors and a single color does
    const colors = [0, 1, 2].map(() => ({ r: 0, g: 1, b: 0, a: 1 }));
    renderable.update("/topic", entity({ colors }), settings, 0n);
    const withVertexColors = materialVersion(renderable);
    expect(withVertexColors).toBeGreaterThan(initial);
    renderable.update("/topic", entity({}), settings, 0n);
    expect(materialVersion(renderable)).toBeGreaterThan(withVertexColors);

    renderable.dispose();
  });
});
