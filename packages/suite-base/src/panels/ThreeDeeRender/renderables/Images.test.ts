// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { Images } from "./Images";
import type { Renderer } from "../Renderer";
import type { ImageRenderable } from "./Images/ImageRenderable";

function hiddenRenderable() {
  return Object.assign(new THREE.Object3D(), {
    userData: { topic: "hidden", settings: { visible: false }, settingsPath: ["topics", "hidden"] },
    dispose: vi.fn(),
    flushPendingDecodes: vi.fn(),
  }) as unknown as ImageRenderable & { dispose: ReturnType<typeof vi.fn> };
}

describe("Images", () => {
  it("disposes the renderable of a hidden topic instead of keeping its texture and decoder", () => {
    const renderer = {
      on: vi.fn(),
      off: vi.fn(),
      topics: [],
      customCameraModels: new Map(),
      config: { topics: {} },
      settings: { errors: { clearPath: vi.fn() }, setNodesForKey: vi.fn() },
    } as unknown as Renderer;
    const images = new Images(renderer);
    const hidden = hiddenRenderable();
    images.renderables.set("hidden", hidden);
    images.add(hidden);

    images.startFrame(0n, "frame", "frame");

    expect(hidden.dispose).toHaveBeenCalledTimes(1);
    expect(images.renderables.size).toBe(0);
    expect(hidden.parent).toBeNull();
  });
});
