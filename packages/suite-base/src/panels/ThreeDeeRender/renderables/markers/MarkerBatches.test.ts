/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";
import type { Mock } from "vitest";
import { setupVitestCanvasMock } from "vitest-canvas-mock";

import { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import { DEFAULT_SCENE_EXTENSION_CONFIG } from "@lichtblick/suite-base/panels/ThreeDeeRender/SceneExtensionConfig";
import { DEFAULT_CAMERA_STATE } from "@lichtblick/suite-base/panels/ThreeDeeRender/camera";
import { DEFAULT_PUBLISH_SETTINGS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/PublishSettings";

import { MarkerBatches } from "./MarkerBatches";
import { RenderableCube } from "./RenderableCube";
import { RenderableMarker } from "./RenderableMarker";
import { RendererConfig } from "../../IRenderer";
import { LAYER_DEFAULT, LAYER_PICK_ONLY } from "../../layers";
import { Marker, MarkerAction, MarkerType } from "../../ros";
import { makePose } from "../../transforms";
import { TopicMarkers } from "../TopicMarkers";

vi.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => ({ default: "" }));
vi.mock(
  "three/webgpu",
  async () => await (await import("../../testing/fakeWebGPURenderer")).mockThreeWebGPU(),
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

function marker(id: number, type: MarkerType, alpha = 1): Marker {
  return {
    header: { frame_id: "map", stamp: { sec: 0, nsec: 0 } },
    ns: "",
    id,
    type,
    action: MarkerAction.ADD,
    pose: { position: { x: id, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    scale: { x: 1, y: 2, z: 3 },
    color: { r: 1, g: 0, b: 0, a: alpha },
    lifetime: { sec: 0, nsec: 0 },
    frame_locked: false,
    points: [],
    colors: [],
    text: "",
    mesh_resource: "",
    mesh_use_embedded_materials: false,
  };
}

describe("MarkerBatches", () => {
  let renderer: Renderer;
  let topic: TopicMarkers;

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
      sceneExtensionConfig: DEFAULT_SCENE_EXTENSION_CONFIG,
      testOptions: {},
      customCameraModels: new Map(),
    });
    renderer.transformTree.getOrCreateFrame("map");
    topic = new TopicMarkers("/markers", renderer, {
      receiveTime: 0n,
      messageTime: 0n,
      frameId: "",
      pose: makePose(),
      settingsPath: ["topics", "/markers"],
      settings: {
        visible: true,
        color: undefined,
        showOutlines: undefined,
        selectedIdVariable: undefined,
        namespaces: {},
      },
      topic: "/markers",
    });
  });

  afterEach(() => {
    renderer.dispose();
    // jsdom has no WebGPU; the renderer warns about it
    (console.warn as Mock).mockClear();
  });

  function byId(id: number): RenderableMarker {
    return topic.namespaces.get("")!.markersById.get(id)!;
  }
  function instanced(): THREE.Object3D[] {
    const batches = topic.children.find((child) => child instanceof MarkerBatches)!;
    return batches.children.filter((child) => (child as THREE.InstancedMesh).count > 0);
  }

  it("draws opaque cubes, spheres and cylinders as instances and picks them as themselves", () => {
    topic.addMarkerMessage(marker(1, MarkerType.CUBE), 0n);
    topic.addMarkerMessage(marker(2, MarkerType.CUBE), 0n);
    topic.addMarkerMessage(marker(3, MarkerType.SPHERE), 0n);
    topic.addMarkerMessage(marker(4, MarkerType.CYLINDER), 0n);
    topic.addMarkerMessage(marker(5, MarkerType.CUBE, 0.5), 0n);
    topic.startFrame(0n, "map", "map");

    // cubes, cube outlines, spheres, cylinders, cylinder outlines
    const counts = instanced().map((object) => (object as THREE.InstancedMesh).count);
    expect(counts.sort()).toEqual([1, 1, 1, 2, 2]);

    const cube = byId(2) as RenderableCube;
    expect(cube.mesh.layers.mask).toBe(1 << LAYER_PICK_ONLY);
    expect(cube.outline.layers.mask).toBe(1 << LAYER_PICK_ONLY);
    // A transparent marker draws on its own, sorted with the other transparent objects
    expect((byId(5) as RenderableCube).mesh.layers.mask).toBe(1 << LAYER_DEFAULT);

    // The instance carries the marker's pose and scale
    const cubes = instanced().find(
      (object) => (object as THREE.InstancedMesh).count === 2 && object instanceof THREE.Mesh,
    ) as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    cubes.getMatrixAt(1, matrix);
    expect(matrix.toArray()).toEqual(
      new THREE.Matrix4()
        .compose(new THREE.Vector3(2, 0, 0), new THREE.Quaternion(), new THREE.Vector3(1, 2, 3))
        .toArray(),
    );
  });

  it("restores a deleted marker's own draw before the pool hands it out", () => {
    topic.addMarkerMessage(marker(1, MarkerType.CUBE), 0n);
    topic.startFrame(0n, "map", "map");
    const cube = byId(1) as RenderableCube;
    topic.addMarkerMessage({ ...marker(1, MarkerType.CUBE), action: MarkerAction.DELETE }, 0n);
    expect(cube.mesh.layers.mask).toBe(1 << LAYER_DEFAULT);
  });

  it("returns a deselected marker to its batch", () => {
    topic.addMarkerMessage(marker(1, MarkerType.CUBE), 0n);
    topic.startFrame(0n, "map", "map");
    const cube = byId(1) as RenderableCube;

    renderer.setSelectedRenderable({ renderable: cube });
    expect(cube.mesh.layers.mask).not.toBe(1 << LAYER_PICK_ONLY);
    renderer.setSelectedRenderable(undefined);
    expect(cube.mesh.layers.mask).toBe(1 << LAYER_PICK_ONLY);
    expect(cube.layers.mask).toBe(1 << LAYER_DEFAULT);
  });
});
