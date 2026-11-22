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

import { FrameAxes } from "./FrameAxes";
import { TopicMarkers } from "./TopicMarkers";
import { RendererConfig } from "../IRenderer";
import { Marker, MarkerAction, MarkerType } from "../ros";
import { makePose, Transform } from "../transforms";
import { updatePose } from "../updatePose";

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

function quat(axis: [number, number, number], angle: number) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), angle);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

function cube(id: number, frameId: string, stampSec: number): Marker {
  return {
    header: { frame_id: frameId, stamp: { sec: stampSec, nsec: 0 } },
    ns: "ns",
    id,
    type: MarkerType.CUBE,
    action: MarkerAction.ADD,
    pose: { position: { x: id, y: 2, z: -1 }, orientation: quat([1, 2, 3], 0.3 * id) },
    scale: { x: 1, y: 1, z: 1 },
    color: { r: 1, g: 0, b: 0, a: 1 },
    lifetime: { sec: 0, nsec: 0 },
    frame_locked: false,
    points: [],
    colors: [],
    text: "",
    mesh_resource: "",
    mesh_use_embedded_materials: false,
  };
}

describe("TopicMarkers.startFrame", () => {
  let renderer: Renderer;

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
    // map <- base (moving) <- arm, all rotated
    const tree = renderer.transformTree;
    for (const [sec, x] of [
      [1, 0],
      [3, 4],
    ] as const) {
      tree.addTransform(
        "base",
        "map",
        BigInt(sec) * 1_000_000_000n,
        new Transform([x, 1, 0], [0, 0, Math.sin(0.4 * sec), Math.cos(0.4 * sec)]),
      );
    }
    const q = quat([0, 1, 1], 0.7);
    tree.addTransform("arm", "base", 0n, new Transform([0.5, -2, 1], [q.x, q.y, q.z, q.w]));
  });

  afterEach(() => {
    renderer.dispose();
    // jsdom has no WebGPU; the renderer warns about it
    (console.warn as Mock).mockClear();
  });

  function makeTopic(): TopicMarkers {
    return new TopicMarkers("/markers", renderer, {
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
  }

  it("poses each marker as the per-marker transform did", () => {
    const topic = makeTopic();
    const markers = [cube(1, "arm", 2), cube(2, "arm", 2), cube(3, "base", 2), cube(4, "map", 1)];
    for (const marker of markers) {
      topic.addMarkerMessage(marker, 2_000_000_000n);
    }
    topic.startFrame(2_500_000_000n, "base", "map");

    for (const marker of markers) {
      const renderable = topic.namespaces.get("ns")!.markersById.get(marker.id)!;
      const expected = new THREE.Object3D();
      expected.userData.pose = marker.pose;
      expect(
        updatePose(
          expected,
          renderer.transformTree,
          "base",
          "map",
          marker.header.frame_id,
          2_500_000_000n,
          BigInt(marker.header.stamp.sec) * 1_000_000_000n,
        ),
      ).toBe(true);
      expect(renderable.visible).toBe(true);
      for (const axis of ["x", "y", "z"] as const) {
        expect(renderable.position[axis]).toBeCloseTo(expected.position[axis], 9);
      }
      expect(Math.abs(renderable.quaternion.dot(expected.quaternion))).toBeCloseTo(1, 9);
    }
  });

  it("normalizes the composed orientation of a marker with a non-unit quaternion", () => {
    const topic = makeTopic();
    const marker = cube(1, "arm", 2);
    marker.pose.orientation = { x: 0, y: 0, z: 0.6, w: 1.6 };
    topic.addMarkerMessage(marker, 2_000_000_000n);
    topic.startFrame(2_000_000_000n, "map", "map");
    const renderable = topic.namespaces.get("ns")!.markersById.get(1)!;
    expect(renderable.quaternion.length()).toBeCloseTo(1, 12);
  });

  it("hides markers whose frame has no transform and reports it", () => {
    const topic = makeTopic();
    topic.addMarkerMessage(cube(1, "unknown", 2), 2_000_000_000n);
    topic.addMarkerMessage(cube(2, "arm", 2), 2_000_000_000n);
    topic.startFrame(2_000_000_000n, "map", "map");

    const byId = topic.namespaces.get("ns")!.markersById;
    expect(byId.get(1)!.visible).toBe(false);
    expect(byId.get(2)!.visible).toBe(true);
    expect(renderer.settings.errors.errors.errorAtPath(["topics", "/markers"])).toMatch(/unknown/);
  });

  it("skips repainting with unchanged inputs and redoes it after a change", () => {
    const topic = makeTopic();
    topic.addMarkerMessage(cube(1, "arm", 2), 2_000_000_000n);
    topic.startFrame(2_000_000_000n, "map", "map");
    const renderable = topic.namespaces.get("ns")!.markersById.get(1)!;
    const posed = renderable.position.clone();

    // A camera move repaints with the same time, frames and transforms (and a new config)
    renderable.position.set(0, 0, 0);
    renderer.config = { ...renderer.config, cameraState: { ...DEFAULT_CAMERA_STATE, distance: 3 } };
    topic.startFrame(2_000_000_000n, "map", "map");
    expect(renderable.position.toArray()).toEqual([0, 0, 0]);

    // A new time poses again
    topic.startFrame(2_100_000_000n, "map", "map");
    expect(renderable.position.distanceTo(posed)).toBeLessThan(1e-9);

    // So does a new message at the same time
    renderable.position.set(0, 0, 0);
    topic.addMarkerMessage(cube(1, "arm", 2), 2_000_000_000n);
    topic.startFrame(2_100_000_000n, "map", "map");
    expect(renderable.position.distanceTo(posed)).toBeLessThan(1e-9);

    // And a topic settings change
    renderable.position.set(0, 0, 0);
    renderer.config = { ...renderer.config, topics: { "/markers": { visible: true } } };
    topic.startFrame(2_100_000_000n, "map", "map");
    expect(renderable.position.distanceTo(posed)).toBeLessThan(1e-9);

    // And a transform change
    renderable.position.set(0, 0, 0);
    renderer.transformTree.addTransform("arm", "base", 1n, Transform.Identity());
    topic.startFrame(2_100_000_000n, "map", "map");
    expect(renderable.position.length()).toBeGreaterThan(0);
  });

  it("re-poses a paused panel after a frame offset edit", () => {
    const topic = makeTopic();
    topic.addMarkerMessage(cube(1, "arm", 2), 2_000_000_000n);
    topic.startFrame(2_000_000_000n, "map", "map");
    const renderable = topic.namespaces.get("ns")!.markersById.get(1)!;
    const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;
    renderer.emit("transformTreeUpdated", renderer);
    const moved = (edit: () => void) => {
      const before = renderable.position.clone();
      edit();
      topic.startFrame(2_000_000_000n, "map", "map");
      return renderable.position.distanceTo(before);
    };

    // A legacy per-panel offset from the config, applied once offsets become editable
    renderer.updateConfig((draft) => {
      draft.transforms["frame:arm"] = { xyzOffset: [0, 2, 0] };
    });
    expect(
      moved(() => {
        frameAxes.handleSettingsAction({
          action: "update",
          payload: { path: ["transforms", "settings", "editable"], input: "boolean", value: true },
        });
      }),
    ).toBeGreaterThan(0);

    // A layout-wide offset typed in the settings
    expect(
      moved(() => {
        frameAxes.handleSettingsAction({
          action: "update",
          payload: {
            path: ["transforms", "frame:arm", "xyzOffset"],
            input: "vec3",
            value: [1, 0, 0],
          },
        });
      }),
    ).toBeGreaterThan(0);
  });
});
