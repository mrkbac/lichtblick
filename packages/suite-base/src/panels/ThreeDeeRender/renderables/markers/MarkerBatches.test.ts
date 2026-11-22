/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/webgpu/LineSegments2.js";
import type { Mock } from "vitest";
import { setupVitestCanvasMock } from "vitest-canvas-mock";

import { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import { DEFAULT_SCENE_EXTENSION_CONFIG } from "@lichtblick/suite-base/panels/ThreeDeeRender/SceneExtensionConfig";
import { DEFAULT_CAMERA_STATE } from "@lichtblick/suite-base/panels/ThreeDeeRender/camera";
import { DEFAULT_PUBLISH_SETTINGS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/PublishSettings";

import { MarkerBatches } from "./MarkerBatches";
import { RenderableArrow } from "./RenderableArrow";
import { RenderableCube } from "./RenderableCube";
import { RenderableLineList } from "./RenderableLineList";
import { RenderableLineStrip } from "./RenderableLineStrip";
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

    // The instance carries the marker's pose and scale, relative to the batch origin (marker 1)
    const cubes = instanced().find(
      (object) => (object as THREE.InstancedMesh).count === 2 && object instanceof THREE.Mesh,
    ) as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    cubes.getMatrixAt(1, matrix);
    expect(cubes.position.toArray()).toEqual([1, 0, 0]);
    expect(matrix.toArray()).toEqual(
      new THREE.Matrix4()
        .compose(new THREE.Vector3(1, 0, 0), new THREE.Quaternion(), new THREE.Vector3(1, 2, 3))
        .toArray(),
    );
  });

  it("batches the head and shaft of both arrow forms with their own transforms", () => {
    topic.addMarkerMessage(marker(1, MarkerType.ARROW), 0n);
    topic.addMarkerMessage(
      {
        ...marker(2, MarkerType.ARROW),
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 4 },
        ],
      },
      0n,
    );
    topic.addMarkerMessage(marker(3, MarkerType.ARROW, 0.5), 0n);
    topic.startFrame(0n, "map", "map");

    expect(instanced().map((object) => (object as THREE.InstancedMesh).count)).toEqual([
      2, 2, 2, 2,
    ]);
    const arrow = byId(2) as RenderableArrow;
    const transparentArrow = byId(3) as RenderableArrow;
    expect(transparentArrow.shaftMesh.layers.mask).toBe(1 << LAYER_DEFAULT);
    arrow.updateMatrixWorld();
    for (const mesh of [arrow.shaftMesh, arrow.headMesh]) {
      expect(mesh.layers.mask).toBe(1 << LAYER_PICK_ONLY);
      const batch = instanced().find(
        (object): object is THREE.InstancedMesh =>
          object instanceof THREE.InstancedMesh && object.geometry === mesh.geometry,
      )!;
      const instance = new THREE.Matrix4();
      batch.getMatrixAt(1, instance);
      const matrix = new THREE.Matrix4().makeTranslation(...batch.position.toArray());
      matrix.multiply(instance).elements.forEach((value, i) => {
        expect(value).toBeCloseTo(mesh.matrixWorld.elements[i]!, 6);
      });
    }
  });

  it("draws opaque strips and lists together with one depth and color pass per width", () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    ];
    topic.addMarkerMessage({ ...marker(1, MarkerType.LINE_LIST), points }, 0n);
    topic.addMarkerMessage({ ...marker(2, MarkerType.LINE_STRIP), points }, 0n);
    topic.addMarkerMessage({ ...marker(3, MarkerType.LINE_LIST, 0.5), points }, 0n);
    topic.addMarkerMessage(
      { ...marker(4, MarkerType.LINE_LIST), points, scale: { x: 2, y: 1, z: 1 } },
      0n,
    );
    topic.startFrame(0n, "map", "map");

    const batches = topic.children.find((child) => child instanceof MarkerBatches)!;
    const lines = batches.children.filter((child) => child instanceof LineSegments2);
    expect(lines.map((pass) => pass.geometry.instanceCount)).toEqual([2, 2, 1, 1]);
    expect(lines.map((pass) => pass.renderOrder)).toEqual([1, 2, 1, 2]);
    const first = lines[0]!;
    expect(first.position.x).toBe(1);
    const start = first.geometry.getAttribute("instanceStart");
    expect(start.getX(0)).toBe(0);
    expect(start.getX(1)).toBe(1);
    expect((byId(1) as RenderableLineList).line.layers.mask).toBe(1 << LAYER_PICK_ONLY);
    expect((byId(2) as RenderableLineStrip).line.layers.mask).toBe(1 << LAYER_PICK_ONLY);
    expect((byId(3) as RenderableLineList).line.layers.mask).toBe(1 << LAYER_DEFAULT);
  });

  it("stores instances relative to the batch origin, so map-scale coordinates keep precision", () => {
    const far = (id: number, x: number) => ({
      ...marker(id, MarkerType.CUBE),
      pose: { position: { x, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    });
    topic.addMarkerMessage(far(1, 1_000_000), 0n);
    topic.addMarkerMessage(far(2, 1_000_000.01), 0n);
    topic.startFrame(0n, "map", "map");

    const cubes = instanced().find(
      (object) => object instanceof THREE.Mesh && (object as THREE.InstancedMesh).count === 2,
    ) as THREE.InstancedMesh;
    expect(cubes.position.x).toBe(1_000_000);
    const matrix = new THREE.Matrix4();
    cubes.getMatrixAt(1, matrix);
    // float32 at 1e6 has a 0.06 m step; relative to the origin the 1 cm offset survives
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).x).toBeCloseTo(0.01, 5);
  });

  it("keeps the instances already written when a batch grows", () => {
    for (let id = 1; id <= 40; id++) {
      topic.addMarkerMessage(marker(id, MarkerType.CUBE), 0n);
    }
    topic.startFrame(0n, "map", "map");

    const cubes = instanced().find(
      (object) => object instanceof THREE.Mesh && (object as THREE.InstancedMesh).count === 40,
    ) as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < 40; i++) {
      cubes.getMatrixAt(i, matrix);
      // Marker ids 1..40 sit at x = id; the batch origin is marker 1
      expect(new THREE.Vector3().setFromMatrixPosition(matrix).x).toBe(i);
      cubes.getColorAt(i, color);
      expect(color.r).toBeCloseTo(1, 6);
    }
  });

  it("batches distant markers in their own cell and draws reflected markers separately", () => {
    topic.addMarkerMessage(marker(1, MarkerType.CUBE), 0n);
    topic.addMarkerMessage({ ...marker(2, MarkerType.CUBE), scale: { x: -1, y: 1, z: 1 } }, 0n);
    topic.addMarkerMessage(
      {
        ...marker(3, MarkerType.CUBE),
        pose: { position: { x: 1e6, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      },
      0n,
    );
    topic.startFrame(0n, "map", "map");

    expect((byId(1) as RenderableCube).mesh.layers.mask).toBe(1 << LAYER_PICK_ONLY);
    expect((byId(2) as RenderableCube).mesh.layers.mask).toBe(1 << LAYER_DEFAULT);
    expect((byId(3) as RenderableCube).mesh.layers.mask).toBe(1 << LAYER_PICK_ONLY);
    const cubes = instanced().filter((object) => object instanceof THREE.Mesh);
    expect(cubes.map((batch) => batch.position.x)).toEqual([1, 1e6]);
    topic.addMarkerMessage({ ...marker(3, MarkerType.CUBE), action: MarkerAction.DELETE }, 0n);
    topic.startFrame(0n, "map", "map");
    expect(topic.children.find((child) => child instanceof MarkerBatches)?.children).toHaveLength(
      2,
    );
  });

  it("keeps a marker at a non-finite position out of the batch", () => {
    topic.addMarkerMessage(
      {
        ...marker(1, MarkerType.CUBE),
        pose: { position: { x: NaN, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      },
      0n,
    );
    topic.addMarkerMessage(marker(2, MarkerType.CUBE), 0n);
    topic.startFrame(0n, "map", "map");

    expect((byId(1) as RenderableCube).mesh.layers.mask).toBe(1 << LAYER_DEFAULT);
    const cubes = instanced().find((object) => object instanceof THREE.Mesh) as THREE.InstancedMesh;
    expect(cubes.count).toBe(1);
    expect(cubes.position.x).toBe(2);
    const matrix = new THREE.Matrix4();
    cubes.getMatrixAt(0, matrix);
    expect(matrix.toArray().every(Number.isFinite)).toBe(true);
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
