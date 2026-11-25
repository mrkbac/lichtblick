/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LineType, SceneEntity, SceneEntityDeletionType } from "@foxglove/schemas";
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/webgpu/LineSegments2.js";
import type { Mock } from "vitest";
import { setupVitestCanvasMock } from "vitest-canvas-mock";

import { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import { DEFAULT_CAMERA_STATE } from "@lichtblick/suite-base/panels/ThreeDeeRender/camera";
import { DEFAULT_PUBLISH_SETTINGS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/PublishSettings";

import { TopicEntities } from "./TopicEntities";
import { RendererConfig } from "../IRenderer";
import { LAYER_DEFAULT, LAYER_PICK_ONLY } from "../layers";
import { makePose } from "../transforms";
import { MarkerBatches } from "./markers/MarkerBatches";
import { PrimitivePool } from "./primitives/PrimitivePool";

vi.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => ({ default: "" }));
vi.mock(
  "three/webgpu",
  async () => await (await import("../testing/fakeWebGPURenderer")).mockThreeWebGPU(),
);

const config: RendererConfig = {
  cameraState: DEFAULT_CAMERA_STATE,
  followMode: "follow-pose",
  followTf: undefined,
  scene: {},
  transforms: {},
  topics: {},
  layers: {},
  publish: DEFAULT_PUBLISH_SETTINGS,
  imageMode: {},
};

const pose = (x: number) => ({
  position: { x, y: 0, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
});

/** A tracked object: a translucent box, its edges as a line, and a heading arrow */
function entity(id: string, x: number): SceneEntity {
  return {
    timestamp: { sec: 0, nsec: 0 },
    frame_id: "map",
    id,
    lifetime: { sec: 0, nsec: 0 },
    frame_locked: true,
    metadata: [],
    arrows: [
      {
        pose: pose(x),
        shaft_length: 1,
        shaft_diameter: 0.1,
        head_length: 0.3,
        head_diameter: 0.2,
        color: { r: 1, g: 0, b: 0, a: 0.9 },
      },
    ],
    cubes: [{ pose: pose(x), size: { x: 1, y: 2, z: 1 }, color: { r: 0, g: 1, b: 0, a: 0.2 } }],
    spheres: [],
    cylinders: [],
    lines: [
      {
        type: LineType.LINE_LIST,
        pose: pose(0),
        thickness: 0.05,
        scale_invariant: false,
        points: [
          { x, y: 0, z: 0 },
          { x: x + 1, y: 0, z: 0 },
        ],
        color: { r: 0, g: 0, b: 1, a: 0.95 },
        colors: [],
        indices: [],
      },
    ],
    triangles: [],
    texts: [],
    models: [],
  };
}

describe("TopicEntities batching", () => {
  let renderer: Renderer;
  let pool: PrimitivePool;
  let topic: TopicEntities;

  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    setupVitestCanvasMock();
    const parent = document.createElement("div");
    const canvas = document.createElement("canvas");
    parent.appendChild(canvas);
    renderer = new Renderer({
      canvas,
      config,
      interfaceMode: "3d",
      fetchAsset: async () => {
        throw new Error("unused");
      },
      testOptions: {},
      customCameraModels: new Map(),
    });
    renderer.transformTree.getOrCreateFrame("map");
    pool = new PrimitivePool(renderer);
    topic = new TopicEntities("/objects", pool, renderer, {
      receiveTime: 0n,
      messageTime: 0n,
      frameId: "",
      pose: makePose(),
      settingsPath: ["topics", "/objects"],
      settings: {
        visible: true,
        color: undefined,
        showOutlines: true,
        selectedIdVariable: undefined,
      },
      topic: "/objects",
    });
  });

  afterEach(() => {
    topic.dispose();
    pool.dispose();
    renderer.dispose();
    // jsdom has no WebGPU; the renderer warns about it
    (console.warn as Mock).mockClear();
  });

  function batches(): MarkerBatches {
    return topic.children.find((child) => child instanceof MarkerBatches)!;
  }
  /** Objects of each entity, other than the batches */
  function entityDrawables(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    for (const child of topic.children) {
      if (child instanceof MarkerBatches) {
        continue;
      }
      child.traverse((object) => {
        if (object instanceof THREE.InstancedMesh || object instanceof LineSegments2) {
          objects.push(object);
        }
      });
    }
    return objects;
  }

  it("draws every entity's boxes, arrows and lines in shared batches and keeps its own for picking", () => {
    topic.addOrUpdateEntity(entity("a", 0), 0n);
    topic.addOrUpdateEntity(entity("b", 10), 0n);
    topic.startFrame(0n, "map", "map");

    // box + outline, shaft + outline, head + outline: two instances each
    const counts = batches()
      .children.filter(
        (child) => !(child instanceof LineSegments2) && (child as THREE.InstancedMesh).count > 0,
      )
      .map((child) => (child as THREE.InstancedMesh).count);
    expect(counts).toEqual([2, 2, 2, 2, 2, 2]);
    const lines = batches().children.filter((child) => child instanceof LineSegments2);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.geometry.instanceCount).toBe(2);

    const own = entityDrawables();
    expect(own.length).toBeGreaterThan(0);
    for (const object of own) {
      expect(object.layers.mask).toBe(1 << LAYER_PICK_ONLY);
    }
  });

  it("draws a deleted entity's primitives on their own again before the pool reuses them", () => {
    topic.addOrUpdateEntity(entity("a", 0), 0n);
    topic.startFrame(0n, "map", "map");
    const own = entityDrawables();
    topic.deleteEntities({
      type: SceneEntityDeletionType.ALL,
      id: "",
      timestamp: { sec: 0, nsec: 0 },
    });
    for (const object of own) {
      expect(object.layers.mask).toBe(1 << LAYER_DEFAULT);
    }
  });
});
