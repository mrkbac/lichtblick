// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { SceneEntity } from "@foxglove/schemas";
import * as THREE from "three";

import { RenderableTexts } from "./RenderableTexts";
import type { Renderer } from "../../Renderer";
import { LayerSettingsEntity } from "../../settings";

const settings: LayerSettingsEntity = {
  visible: true,
  showOutlines: true,
  color: undefined,
  selectedIdVariable: undefined,
};

const entity: SceneEntity = {
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
  triangles: [],
  texts: [
    {
      pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      billboard: true,
      font_size: 1,
      scale_invariant: false,
      color: { r: 1, g: 1, b: 1, a: 1 },
      text: "label",
    },
  ],
  models: [],
};

// The real LabelPool needs a canvas; a label here only has to be an Object3D with setters.
function fakeLabelPool() {
  const free: THREE.Object3D[] = [];
  const noop = () => {};
  return {
    acquire: () =>
      free.pop() ??
      Object.assign(new THREE.Object3D(), {
        setText: noop,
        setColor: noop,
        setBackgroundColor: noop,
        setBillboard: noop,
        setSizeAttenuation: noop,
        setLineHeight: noop,
      }),
    release: (label: THREE.Object3D) => free.push(label),
  };
}

describe("RenderableTexts", () => {
  it("hides labels when showLabels is off and hands visible labels back to the pool", () => {
    const labelPool = fakeLabelPool();
    const renderable = new RenderableTexts({ labelPool } as unknown as Renderer);

    renderable.update("/topic", entity, settings, 0n);
    const label = renderable.children[0]!;
    expect(label.visible).toBe(true);

    renderable.updateSettings({ ...settings, showLabels: false });
    expect(label.visible).toBe(false);

    renderable.dispose();
    expect(labelPool.acquire()).toBe(label);
    expect(label.visible).toBe(true);
  });
});
