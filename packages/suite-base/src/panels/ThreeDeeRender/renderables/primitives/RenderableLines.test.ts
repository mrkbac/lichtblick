// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LinePrimitive, LineType, SceneEntity } from "@foxglove/schemas";
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

import { RenderableLines } from "./RenderableLines";
import type { IRenderer } from "../../IRenderer";
import { LayerSettingsEntity } from "../../settings";

const settings: LayerSettingsEntity = {
  visible: true,
  showOutlines: true,
  color: undefined,
  selectedIdVariable: undefined,
};

function entity(line: Partial<LinePrimitive>): SceneEntity {
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
    lines: [
      {
        type: LineType.LINE_STRIP,
        pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
        thickness: 1,
        scale_invariant: true,
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 1, z: 1 },
          { x: 2, y: 0, z: 0 },
        ],
        color: { r: 1, g: 0, b: 0, a: 1 },
        colors: [],
        indices: [],
        ...line,
      },
    ],
    triangles: [],
    texts: [],
    models: [],
  };
}

function materialVersion(renderable: RenderableLines): number {
  let version = 0;
  renderable.traverse((object) => {
    const material = (object as Partial<THREE.Mesh>).material as THREE.Material | undefined;
    version += material?.version ?? 0;
  });
  return version;
}

describe("RenderableLines", () => {
  it.each([
    [LineType.LINE_STRIP, 1],
    [LineType.LINE_LOOP, 2],
    [LineType.LINE_LIST, 1],
  ])("draws only the current segments after type %s shrinks", (type, count) => {
    const renderer = { input: { canvasSize: new THREE.Vector2(100, 100) } } as IRenderer;
    const renderable = new RenderableLines(renderer);
    const points = [0, 1, 2, 3].map((x) => ({ x, y: 0, z: 0 }));
    renderable.update("/topic", entity({ type, points }), settings, 0n);
    const line = renderable.children[0]!.children[0] as LineSegments2;
    const buffer = line.geometry.getAttribute("instanceStart");
    renderable.update("/topic", entity({ type, points: points.slice(0, 2) }), settings, 1n);
    expect(line.geometry.getAttribute("instanceStart")).toBe(buffer);
    expect(line.geometry.instanceCount).toBe(count);
    renderable.dispose();
  });

  it("only rebuilds the line shader when a compiled property changes", () => {
    const renderer = { input: { canvasSize: new THREE.Vector2(100, 100) } } as IRenderer;
    const renderable = new RenderableLines(renderer);

    renderable.update("/topic", entity({}), settings, 0n);
    const initial = materialVersion(renderable);
    for (let i = 1; i <= 10; i++) {
      renderable.update(
        "/topic",
        entity({ thickness: i, color: { r: i / 10, g: 0, b: 0, a: 1 } }),
        settings,
        BigInt(i),
      );
    }
    expect(materialVersion(renderable)).toBe(initial);

    renderable.update("/topic", entity({ scale_invariant: false }), settings, 11n);
    expect(materialVersion(renderable)).toBeGreaterThan(initial);

    const beforeVertexColors = materialVersion(renderable);
    const colors = [0, 1, 2].map(() => ({ r: 0, g: 1, b: 0, a: 1 }));
    renderable.update("/topic", entity({ scale_invariant: false, colors }), settings, 12n);
    expect(materialVersion(renderable)).toBeGreaterThan(beforeVertexColors);

    renderable.dispose();
  });
});
