/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fromNanoSec } from "@foxglove/rostime";
import { FrameTransform, FrameTransforms } from "@foxglove/schemas";
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { Mock } from "vitest";
import { setupVitestCanvasMock } from "vitest-canvas-mock";

import { CameraModelsMap } from "@lichtblick/den/image/types";
import { MessageEvent } from "@lichtblick/suite";
import { Asset, DraggedMessagePath } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import {
  Renderer,
  stopThreeAnimationLoop,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import { DEFAULT_CAMERA_STATE } from "@lichtblick/suite-base/panels/ThreeDeeRender/camera";
import { HOVER_PICK_THROTTLE_MS } from "@lichtblick/suite-base/panels/ThreeDeeRender/constants";
import { CameraStateSettings } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/CameraStateSettings";
import { DEFAULT_PUBLISH_SETTINGS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/PublishSettings";
import { TFMessage, TransformStamped } from "@lichtblick/suite-base/panels/ThreeDeeRender/ros";
import {
  AddTransformResult,
  makePose,
  Transform,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms";
import { BasicBuilder } from "@lichtblick/test-builders";

import { DynamicBufferGeometry } from "./DynamicBufferGeometry";
import { RendererConfig } from "./IRenderer";
import { Picker } from "./Picker";
import { Renderable } from "./Renderable";
import { SceneExtension } from "./SceneExtension";
import type { SharedMap } from "./SharedMap";

vi.mock("./Picker", async () => {
  const actual = await vi.importActual("./Picker");
  return {
    ...actual,
    Picker: vi.fn().mockImplementation(function () {
      return {
        pick: vi.fn(async () => undefined),
        dispose: vi.fn(),
      };
    }),
  };
});

// Jest doesn't support ES module imports fully yet, so we need to mock the wasm file
vi.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => ({ default: "" }));

// jsdom has no WebGPU
// only mocking what we currently use
vi.mock(
  "three/webgpu",
  async () => await (await import("./testing/fakeWebGPURenderer")).mockThreeWebGPU(),
);

beforeEach(() => {
  // Copied from: https://jestjs.io/docs/manual-mocks#mocking-methods-which-are-not-implemented-in-jsdom
  // mock matchMedia for `Renderer` class in ThreeDeeRender
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(function (query) {
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });
});

const defaultRendererConfig: RendererConfig = {
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

const makeTf = () => ({
  translation: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
});

function createTFMessageEvent(
  parentId: string,
  childId: string,
  receiveTime: bigint,
  headerStamps: bigint[],
  topic: string = "/tf",
): MessageEvent<TFMessage> {
  const stampedTfs = headerStamps.map((stamp) => ({
    header: {
      stamp: fromNanoSec(stamp),
      frame_id: parentId,
    },
    child_frame_id: childId,
    transform: makeTf(),
  }));
  return {
    topic,
    receiveTime: fromNanoSec(receiveTime),
    schemaName: "tf2_msgs/TFMessage",
    message: {
      transforms: stampedTfs,
    },
    sizeInBytes: 0,
  };
}

function createFrameTransformEvent(
  parentId: string,
  childId: string,
  receiveTime: bigint,
  stamp: bigint,
  topic: string = "/tf",
): MessageEvent<FrameTransform> {
  return {
    topic,
    receiveTime: fromNanoSec(receiveTime),
    schemaName: "foxglove.FrameTransform",
    message: {
      timestamp: fromNanoSec(stamp),
      parent_frame_id: parentId,
      child_frame_id: childId,
      translation: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
    sizeInBytes: 0,
  };
}

function createFrameTransformsEvent(
  transforms: { parentId: string; childId: string; stamp: bigint }[],
  receiveTime: bigint,
  topic: string = "/tf",
): MessageEvent<FrameTransforms> {
  return {
    topic,
    receiveTime: fromNanoSec(receiveTime),
    schemaName: "foxglove.FrameTransforms",
    message: {
      transforms: transforms.map(({ parentId, childId, stamp }) => ({
        timestamp: fromNanoSec(stamp),
        parent_frame_id: parentId,
        child_frame_id: childId,
        translation: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      })),
    },
    sizeInBytes: 0,
  };
}

function createTransformStampedEvent(
  parentId: string,
  childId: string,
  receiveTime: bigint,
  stamp: bigint,
  topic: string = "/tf",
): MessageEvent<TransformStamped> {
  return {
    topic,
    receiveTime: fromNanoSec(receiveTime),
    schemaName: "geometry_msgs/TransformStamped",
    message: {
      header: {
        stamp: fromNanoSec(stamp),
        frame_id: parentId,
      },
      child_frame_id: childId,
      transform: makeTf(),
    },
    sizeInBytes: 0,
  };
}

const fetchAsset = async (uri: string, options?: { signal?: AbortSignal }): Promise<Asset> => {
  const response = await fetch(uri, options);
  return {
    uri,
    data: new Uint8Array(await response.arrayBuffer()),
    mediaType: response.headers.get("content-type") ?? undefined,
  };
};
const defaultRendererProps = {
  config: defaultRendererConfig,
  interfaceMode: "3d" as const,
  fetchAsset,
  testOptions: {},
  customCameraModels: new Map(),
};
describe("3D Renderer", () => {
  let canvas = document.createElement("canvas");
  let parent = document.createElement("div");
  beforeEach(() => {
    vi.clearAllMocks();
    setupVitestCanvasMock();
    parent = document.createElement("div");
    canvas = document.createElement("canvas");
    parent.appendChild(canvas);
  });
  afterEach(() => {
    (console.warn as Mock).mockClear();
  });

  it.each([true, false])("fits visible topic geometry in perspective=%s", (perspective) => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const setCamera = vi.spyOn(renderer, "setCameraState");
    const getCamera = vi
      .spyOn(renderer, "getCameraState")
      .mockReturnValue({ ...DEFAULT_CAMERA_STATE, perspective });
    renderer.zoomToData();
    expect(setCamera).not.toHaveBeenCalled();

    const extension = new SceneExtension("test-data", renderer);
    const addBox = (path: string, x: number, options = { visible: true }) => {
      const { visible } = options;
      const renderable = new Renderable(`${path}${x}`, renderer, {
        receiveTime: 0n,
        messageTime: 0n,
        frameId: "",
        pose: makePose(),
        settingsPath: [path, "test"],
        settings: { visible, frameLocked: true },
      });
      renderable.visible = visible;
      renderable.position.x = x;
      renderable.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
      extension.add(renderable);
      extension.renderables.set(renderable.name, renderable);
      return renderable;
    };
    const data = addBox("topics", 100);
    const lineGeometry = new LineSegmentsGeometry().setPositions([
      0, 0, 0, 1, 1, 1, 10000, 10000, 10000, 20000, 20000, 20000,
    ]);
    lineGeometry.instanceCount = 1;
    data.add(new LineSegments2(lineGeometry));
    const pointGeometry = new DynamicBufferGeometry();
    pointGeometry.createAttribute("position", Float32Array, 3);
    pointGeometry.resize(3);
    pointGeometry.getAttribute("position").setXYZ(0, 0, 0, 0);
    pointGeometry.getAttribute("position").setXYZ(1, 1, 1, 1);
    pointGeometry.getAttribute("position").setXYZ(2, 10000, 10000, 10000);
    pointGeometry.resize(2);
    data.add(new THREE.Points(pointGeometry));
    addBox("topics", 10000, { visible: false });
    addBox("layers", -10000);
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(10000, 10000, 10000));
    hidden.visible = false;
    extension.renderables.get("topics100")!.add(hidden);
    renderer.sceneExtensions.set(extension.extensionId, extension);
    renderer.zoomToData();
    expect(setCamera).toHaveBeenCalledWith(
      expect.objectContaining({
        targetOffset: [100, 0, 0],
        perspective,
        distance: expect.any(Number),
      }),
    );
    const distance = setCamera.mock.calls[0]![0].distance;
    const radius = Math.sqrt(3) * 1.1;
    expect(distance).toBeCloseTo(perspective ? radius / Math.sin(Math.PI / 8) : 2 * radius);
    for (const fovy of [0, Number.MIN_VALUE, Number.NaN, Number.POSITIVE_INFINITY]) {
      getCamera.mockReturnValue({ ...DEFAULT_CAMERA_STATE, perspective: true, fovy });
      setCamera.mockClear();
      renderer.zoomToData();
      expect(setCamera).not.toHaveBeenCalled();
    }
    renderer.dispose();
  });

  it.each([true, false])(
    "fits point clouds with NaN points and cube instances, extending far in perspective=%s",
    (perspective) => {
      const renderer = new Renderer({ ...defaultRendererProps, canvas });
      const setCamera = vi.spyOn(renderer, "setCameraState");
      vi.spyOn(renderer, "getCameraState").mockReturnValue({
        ...DEFAULT_CAMERA_STATE,
        perspective,
        far: 1,
      });
      const extension = new SceneExtension("test-data", renderer);
      const renderable = new Renderable("cloud", renderer, {
        receiveTime: 0n,
        messageTime: 0n,
        frameId: "",
        pose: makePose(),
        settingsPath: ["topics", "cloud"],
        settings: { visible: true, frameLocked: true },
      });
      const points = new DynamicBufferGeometry();
      points.createAttribute("position", Float32Array, 3);
      points.resize(3);
      points.getAttribute("position").setXYZ(0, 0, 0, 0);
      points.getAttribute("position").setXYZ(1, Number.NaN, 0, 0);
      points.getAttribute("position").setXYZ(2, 4, 0, 0);
      renderable.add(new THREE.Points(points));
      const cubes = new THREE.InstancedBufferGeometry();
      cubes.setAttribute("position", new THREE.BoxGeometry(1, 1, 1).getAttribute("position"));
      cubes.setAttribute(
        "instancePosition",
        new THREE.InstancedBufferAttribute(new Float32Array([2, 4, 0]), 3),
      );
      cubes.instanceCount = 1;
      renderable.add(new THREE.Mesh(cubes));
      extension.add(renderable);
      extension.renderables.set(renderable.name, renderable);
      renderer.sceneExtensions.set(extension.extensionId, extension);
      renderer.zoomToData();
      const state = setCamera.mock.calls[0]![0];
      expect(state.targetOffset).toEqual([2, 2, 0]);
      // Bounds span [0, 0, 0] to [4, 4, 0]: the far side must stay inside the clipping range
      const radius = Math.sqrt(8);
      const farSide = perspective ? state.far - state.distance : state.far / 2 - state.near;
      expect(farSide).toBeGreaterThan(radius);
      renderer.dispose();
    },
  );

  it("constructs a renderer without error", () => {
    expect(() => new Renderer({ ...defaultRendererProps, canvas })).not.toThrow();
  });

  it("constructs a renderer in image interface mode", () => {
    // Given: Props with image interface mode
    const imageRendererProps = {
      ...defaultRendererProps,
      interfaceMode: "image" as const,
    };

    // When: Creating renderer in image mode
    const renderer = new Renderer({ ...imageRendererProps, canvas });

    // Then: Should be in image mode
    expect(renderer.interfaceMode).toBe("image");
    renderer.dispose();
  });

  it("disposes all resources correctly", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const disposeSpy = vi.spyOn(renderer.gl, "dispose");
    const inputDisposeSpy = vi.spyOn(renderer.input, "dispose");

    // When: Disposing the renderer
    renderer.dispose();

    // Then: All resources should be disposed
    expect(disposeSpy).toHaveBeenCalled();
    expect(inputDisposeSpy).toHaveBeenCalled();
  });

  it("sets and retrieves camera sync error", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    expect(renderer.cameraSyncError()).toBeUndefined();

    // When: Setting a camera sync error
    renderer.setCameraSyncError("Test error message");

    // Then: Error should be retrievable
    expect(renderer.cameraSyncError()).toBe("Test error message");

    // When: Clearing the error
    renderer.setCameraSyncError(undefined);

    // Then: Error should be undefined
    expect(renderer.cameraSyncError()).toBeUndefined();

    renderer.dispose();
  });

  it("returns pixel ratio from WebGL renderer", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });

    // When: Getting pixel ratio
    const pixelRatio = renderer.getPixelRatio();

    // Then: Should return mocked pixel ratio
    expect(pixelRatio).toBe(1);

    renderer.dispose();
  });

  it("cancels a queued animation frame when animationFrame runs synchronously", () => {
    // Given
    const mockResult = BasicBuilder.number();
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(function () {
        return mockResult;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(function () {
        return undefined;
      });

    const renderer = new Renderer({ ...defaultRendererProps, canvas });

    // Renderer init may schedule internal frames; focus this test on the explicit queue+sync path.
    requestAnimationFrameSpy.mockClear();
    cancelAnimationFrameSpy.mockClear();

    // When
    // Simulate seek/clear code path that queues a frame, then immediately renders synchronously.
    renderer.queueAnimationFrame();
    renderer.animationFrame();

    // Then
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(mockResult);

    renderer.dispose();
  });

  it("moves a panel to the next display frame once the frame's drawing budget is used", () => {
    // Given: two panels queue a frame for the same display frame, and the first draw is slow
    const callbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(function (callback) {
        return callbacks.push(callback);
      });
    let now = 1000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    const first = new Renderer({ ...defaultRendererProps, canvas });
    const second = new Renderer({ ...defaultRendererProps, canvas });
    const firstFrames = vi.fn(() => {
      now += 10;
    });
    const secondFrames = vi.fn();
    first.on("startFrame", firstFrames);
    second.on("startFrame", secondFrames);
    callbacks.length = 0;
    const runFrame = (time: number) => {
      for (const callback of callbacks.splice(0)) {
        callback(time);
      }
    };

    // When
    first.queueAnimationFrame();
    second.queueAnimationFrame();
    runFrame(1);

    // Then: the second panel draws first thing in the next frame
    expect(firstFrames).toHaveBeenCalledTimes(1);
    expect(secondFrames).not.toHaveBeenCalled();
    runFrame(2);
    expect(secondFrames).toHaveBeenCalledTimes(1);

    first.dispose();
    second.dispose();
    nowSpy.mockRestore();
    requestAnimationFrameSpy.mockRestore();
  });

  it("stops three's idle animation loop and advances the node frame once per drawn frame", async () => {
    // Given
    const visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const gl = renderer.gl as unknown as {
      _animation: { start(): void; stop: Mock };
      _nodes: { nodeFrame: { update: Mock; frameId: number } };
      info: { frame: number };
    };
    const { _animation: animation, _nodes: nodes } = gl;
    const { nodeFrame } = nodes;
    nodeFrame.update.mockImplementation(() => {
      nodeFrame.frameId++;
    });
    await renderer.ready;
    expect(animation.stop).toHaveBeenCalled();

    // When: three calls start() from every render() and compute(), e.g. pick passes
    animation.start();
    animation.start();
    // Then: they reuse the current frame
    expect(nodeFrame.update).not.toHaveBeenCalled();

    // When: a frame is drawn
    renderer.animationFrame();
    // Then: the node frame advances once, and GPU timings are keyed by it
    expect(nodeFrame.update).toHaveBeenCalledTimes(1);
    expect(gl.info.frame).toBe(nodeFrame.frameId);
    renderer.dispose();
    visible.mockRestore();
  });

  it("clears before each scene draw a map triggers, so transparent objects don't accumulate", async () => {
    // Given: a map that draws the scene from its own repaints
    let drawScene = (): void => {};
    const sharedMap = {
      layerId: undefined,
      attach: (_renderer: unknown, draw: () => void) => {
        drawScene = draw;
      },
      detach: vi.fn(),
      render: vi.fn(),
      map: { setPixelRatio: vi.fn(), resize: vi.fn() },
    } as unknown as SharedMap;
    const renderer = new Renderer({ ...defaultRendererProps, canvas, sharedMap });
    await renderer.ready;
    const gl = renderer.gl as unknown as { clear: Mock; render: Mock };
    gl.clear.mockClear();

    // When: the map repaints twice between our frames
    drawScene();
    drawScene();

    // Then: each draw starts from a cleared canvas
    expect(gl.clear).toHaveBeenCalledTimes(2);
    renderer.dispose();
  });

  it("relies on three internals that still exist", async () => {
    // Given
    const actual = await vi.importActual<typeof import("three/webgpu")>("three/webgpu");
    const proto = actual.WebGPURenderer.prototype;
    // Then: render() and compute() advance frames only through _animation.start(), which
    // stopThreeAnimationLoop replaces; init() creates the animation and the node frame
    expect(proto.render.toString()).toContain("this._animation.start()");
    expect(proto.compute.toString()).toContain("this._animation.start()");
    expect(proto.init.toString()).toContain("new Animation(");
    // And: the frame advance we call instead moves the frame id
    const nodeFrame = new actual.NodeFrame();
    const before = nodeFrame.frameId;
    nodeFrame.update();
    expect(nodeFrame.frameId).toBe(before + 1);
  });

  it("keeps rendering when three's animation internals are missing", () => {
    // Given
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // When / Then
    expect(() => {
      stopThreeAnimationLoop({} as Parameters<typeof stopThreeAnimationLoop>[0]);
    }).not.toThrow();
    warn.mockRestore();
  });

  it("draws when the panel document is visible while the opener is hidden", async () => {
    // Given
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const child = iframe.contentWindow!;
    const childDocument = iframe.contentDocument!;
    const childCanvas = childDocument.createElement("canvas");
    childDocument.body.appendChild(childCanvas);
    Object.defineProperty(child, "matchMedia", { value: window.matchMedia });
    const visible = vi.spyOn(childDocument, "visibilityState", "get").mockReturnValue("visible");
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const frame = vi.spyOn(child, "requestAnimationFrame").mockReturnValue(1);
    const renderer = new Renderer({ ...defaultRendererProps, canvas: childCanvas });
    await renderer.ready;
    try {
      const draw = vi.spyOn(renderer.gl, "render");
      // When
      renderer.animationFrame();
      // Then
      expect(draw).toHaveBeenCalled();
      frame.mockClear();
      childDocument.dispatchEvent(new Event("visibilitychange"));
      expect(frame).toHaveBeenCalledWith(renderer.animationFrame);
    } finally {
      renderer.dispose();
      hidden.mockRestore();
      visible.mockRestore();
      frame.mockRestore();
      iframe.remove();
    }
  });

  it("skips resize and drawing while the canvas is empty", async () => {
    // Given: a panel collapsed to 0 wide, e.g. while another panel is fullscreen
    const visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    await renderer.ready;
    const setSize = vi.spyOn(renderer.gl, "setSize");
    setSize.mockClear();
    const render = vi.spyOn(renderer.gl, "render");

    // When
    renderer.input.emit("resize", new THREE.Vector2(0, 300));
    // Then: the canvas keeps its last size
    expect(setSize).not.toHaveBeenCalled();

    // When: the drawing buffer is empty anyway (e.g. the panel mounted collapsed)
    vi.spyOn(renderer.gl, "getDrawingBufferSize").mockImplementation((target) =>
      target.set(0, 300),
    );
    renderer.animationFrame();
    // Then
    expect(render).not.toHaveBeenCalled();

    renderer.dispose();
    visible.mockRestore();
  });

  it("skips GPU work while the tab is hidden and repaints when it is shown", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(function () {
        return 1;
      });
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    await renderer.ready;
    const render = vi.spyOn(renderer.gl, "render");

    try {
      visibility.mockReturnValue("hidden");
      render.mockClear();
      renderer.addMessageEventBatch([createTFMessageEvent("parent", "child", 1n, [1n])]);
      renderer.animationFrame();
      expect(render).not.toHaveBeenCalled();
      // Messages are still processed, so the queues don't grow while hidden
      expect(renderer.transformTree.hasFrame("child")).toBe(true);
      const queues = renderer.schemaSubscriptions.get("tf2_msgs/TFMessage")!;
      expect(queues.every((subscription) => subscription.queue == undefined)).toBe(true);

      visibility.mockReturnValue("visible");
      requestAnimationFrameSpy.mockClear();
      document.dispatchEvent(new Event("visibilitychange"));
      expect(requestAnimationFrameSpy).toHaveBeenCalledWith(renderer.animationFrame);
      renderer.animationFrame();
      expect(render).toHaveBeenCalled();
    } finally {
      renderer.dispose();
      visibility.mockRestore();
      requestAnimationFrameSpy.mockRestore();
    }
  });

  it("enables and disables picking mode", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });

    // When: Enabling picking
    renderer.setPickingEnabled(true);

    // Then: Picking should be enabled (internal state)
    expect(() => {
      renderer.setPickingEnabled(true);
    }).not.toThrow();

    // When: Disabling picking
    renderer.setPickingEnabled(false);

    // Then: Should clear selection and disable picking
    expect(() => {
      renderer.setPickingEnabled(false);
    }).not.toThrow();

    renderer.dispose();
  });

  describe("hover picking", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function prepareDomForInput(inputCanvas: HTMLCanvasElement, inputParent: HTMLDivElement) {
      // Input relies on clientWidth/clientHeight of the canvas parent.
      Object.defineProperty(inputParent, "clientWidth", { configurable: true, value: 300 });
      Object.defineProperty(inputParent, "clientHeight", { configurable: true, value: 300 });
      // jsdom lacks pointer capture; the camera's OrbitControls capture on pointerdown.
      inputCanvas.setPointerCapture = vi.fn();
      inputCanvas.releasePointerCapture = vi.fn();
      inputCanvas.getBoundingClientRect = vi.fn(function () {
        return {
          left: 0,
          top: 0,
          right: 300,
          bottom: 300,
          width: 300,
          height: 300,
          x: 0,
          y: 0,
          toJSON: () => "",
        };
      });
    }

    /** Picks resolve asynchronously */
    async function flushPicks(): Promise<void> {
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    }

    function createHoverRenderer(): { renderer: Renderer; hoverCanvas: HTMLCanvasElement } {
      const hoverParent = document.createElement("div");
      const hoverCanvas = document.createElement("canvas");
      hoverParent.appendChild(hoverCanvas);
      prepareDomForInput(hoverCanvas, hoverParent);
      const renderer = new Renderer({ ...defaultRendererProps, canvas: hoverCanvas });
      renderer.setPickingEnabled(true);
      return { renderer, hoverCanvas };
    }

    it("emits renderableHovered at most once per HOVER_PICK_THROTTLE_MS while moving the mouse", async () => {
      const { renderer, hoverCanvas } = createHoverRenderer();
      await renderer.ready;

      const hoveredSpy = vi.fn();
      renderer.addListener("renderableHovered", hoveredSpy);

      hoverCanvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 10 }));
      hoverCanvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 11, clientY: 11 }));
      hoverCanvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 12, clientY: 12 }));
      await flushPicks();

      expect(hoveredSpy).toHaveBeenCalledTimes(1);

      // The trailing pick is at where the cursor stopped, not where the throttle started
      vi.advanceTimersByTime(HOVER_PICK_THROTTLE_MS);
      await flushPicks();
      expect(hoveredSpy).toHaveBeenCalledTimes(2);
      expect(hoveredSpy.mock.calls[1]![1]).toEqual(expect.objectContaining({ x: 12, y: 12 }));

      // No move since: no further pick
      vi.advanceTimersByTime(HOVER_PICK_THROTTLE_MS * 2);
      await flushPicks();
      expect(hoveredSpy).toHaveBeenCalledTimes(2);

      renderer.dispose();
    });

    it("does not hover-pick while mouse is down, then resumes after mouseup", async () => {
      const { renderer, hoverCanvas } = createHoverRenderer();
      await renderer.ready;

      const hoveredSpy = vi.fn();
      renderer.addListener("renderableHovered", hoveredSpy);

      hoverCanvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 10 }));
      hoverCanvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 11, clientY: 11 }));
      await flushPicks();
      expect(hoveredSpy).toHaveBeenCalledTimes(0);

      hoverCanvas.dispatchEvent(new MouseEvent("pointerup", { clientX: 11, clientY: 11 }));
      hoverCanvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 12, clientY: 12 }));
      await flushPicks();
      expect(hoveredSpy).toHaveBeenCalledTimes(1);

      renderer.dispose();
    });

    it("does not emit renderableHovered when picking is disabled", () => {
      const hoverParent = document.createElement("div");
      const hoverCanvas = document.createElement("canvas");
      hoverParent.appendChild(hoverCanvas);
      prepareDomForInput(hoverCanvas, hoverParent);

      const renderer = new Renderer({ ...defaultRendererProps, canvas: hoverCanvas });
      renderer.setPickingEnabled(false);

      const hoveredSpy = vi.fn();
      renderer.addListener("renderableHovered", hoveredSpy);

      hoverCanvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 10 }));
      vi.advanceTimersByTime(HOVER_PICK_THROTTLE_MS * 2);
      hoverCanvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 11, clientY: 11 }));

      expect(hoveredSpy).toHaveBeenCalledTimes(0);

      renderer.dispose();
    });
  });

  describe("click picking", () => {
    async function flushPicks(): Promise<void> {
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    }

    async function clickWithPendingPick(): Promise<{
      renderer: Renderer;
      clicked: Mock;
      settle: { resolve: (value: undefined) => void; reject: (error: Error) => void };
    }> {
      const renderer = new Renderer({ ...defaultRendererProps, canvas });
      await renderer.ready;
      renderer.setPickingEnabled(true);
      const picker = vi.mocked(Picker).mock.results.at(-1)!.value as { pick: Mock };
      const settle = {} as {
        resolve: (value: undefined) => void;
        reject: (error: Error) => void;
      };
      picker.pick.mockReturnValueOnce(
        new Promise((resolve, reject) => Object.assign(settle, { resolve, reject })),
      );
      const clicked = vi.fn();
      renderer.addListener("renderablesClicked", clicked);
      const cursor = new THREE.Vector2(5, 5);
      renderer.input.emit("click", cursor, undefined, new MouseEvent("click"));
      // Input reuses its vector
      cursor.set(50, 50);
      return { renderer, clicked, settle };
    }

    it("reports the cursor the click was at", async () => {
      const { renderer, clicked, settle } = await clickWithPendingPick();
      settle.resolve(undefined);
      await flushPicks();
      expect(clicked).toHaveBeenCalledWith([], new THREE.Vector2(5, 5), renderer);
      renderer.dispose();
    });

    it("drops a pick that completes after picking was disabled", async () => {
      const { renderer, clicked, settle } = await clickWithPendingPick();
      renderer.setPickingEnabled(false);
      renderer.setPickingEnabled(true);
      settle.resolve(undefined);
      await flushPicks();
      expect(clicked).not.toHaveBeenCalled();
      renderer.dispose();
    });

    it("treats a readback cancelled by device loss as no result", async () => {
      const { renderer, clicked, settle } = await clickWithPendingPick();
      renderer.gl.onDeviceLost({ api: "WebGPU", message: "", reason: null, originalEvent: {} });
      settle.reject(new Error("mapAsync aborted"));
      await flushPicks();
      expect(clicked).not.toHaveBeenCalled();
      renderer.dispose();
    });
  });

  it("resolves pickPoint to nothing when the device is lost during its readback", async () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    await renderer.ready;
    const picker = vi.mocked(Picker).mock.results.at(-1)!.value as { pick: Mock };
    let reject!: (error: Error) => void;
    picker.pick.mockReturnValueOnce(new Promise((_resolve, rejectPick) => (reject = rejectPick)));
    const point = renderer.pickPoint(new THREE.Vector2(5, 5), new THREE.Vector3());
    renderer.gl.onDeviceLost({ api: "WebGPU", message: "", reason: null, originalEvent: {} });
    reject(new Error("mapAsync aborted"));
    await expect(point).resolves.toBeUndefined();
    renderer.dispose();
  });

  describe("GPU startup", () => {
    it("does not start a renderer disposed while waiting for the device", async () => {
      const renderer = new Renderer({ ...defaultRendererProps, canvas });
      const init = vi.spyOn(renderer.gl, "init");
      renderer.dispose();
      await renderer.ready;
      expect(init).not.toHaveBeenCalled();
    });

    it("keeps a device loss during startup for the panel instead of drawing", async () => {
      const renderer = new Renderer({ ...defaultRendererProps, canvas });
      const lost = vi.fn();
      renderer.addListener("gpuLost", lost);
      vi.spyOn(renderer.gl, "init").mockImplementationOnce(async () => {
        renderer.gl.onDeviceLost({ api: "WebGPU", message: "", reason: null, originalEvent: {} });
        return renderer.gl;
      });
      await renderer.ready;
      expect(renderer.gpuLost).toBe(true);
      expect(lost).not.toHaveBeenCalled();
      const render = vi.spyOn(renderer.gl, "render");
      renderer.animationFrame();
      expect(render).not.toHaveBeenCalled();
      renderer.dispose();
    });

    it("lets scene extensions recheck GPU limits once the device is ready", async () => {
      const renderer = new Renderer({ ...defaultRendererProps, canvas });
      const ready = [...renderer.sceneExtensions.values()].map((extension) =>
        vi.spyOn(extension, "gpuReady"),
      );
      await renderer.ready;
      for (const spy of ready) {
        expect(spy).toHaveBeenCalledTimes(1);
      }
      renderer.dispose();
    });

    it("reports point layers the raster couldn't draw, and clears that once they are drawn", async () => {
      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      const renderer = new Renderer({ ...defaultRendererProps, canvas });
      await renderer.ready;
      const layer = new THREE.Object3D();
      layer.userData.settingsPath = ["topics", "/points"];
      const points = new THREE.Object3D();
      // Child renderables may carry an empty path; the layer's is the one to report on
      points.userData.settingsPath = [];
      layer.add(points);
      const prepare = vi.spyOn(renderer.pointRaster, "prepare").mockImplementation(() => {
        renderer.pointRaster.skipped.set(points as never, "tooManySets");
      });
      const errorAt = () => renderer.settings.errors.errors.errorAtPath(["topics", "/points"]);
      try {
        renderer.animationFrame();
        expect(errorAt()).toMatch(/point layers/);

        // Settings errors are cleared on seek; a layer still skipped gets its warning back
        renderer.settings.errors.clear();
        renderer.animationFrame();
        expect(errorAt()).toMatch(/point layers/);

        prepare.mockImplementation(() => {});
        renderer.animationFrame();
        expect(errorAt()).toBeUndefined();
      } finally {
        renderer.dispose();
        visibility.mockRestore();
      }
    });

    it("reports a loss after startup and stops drawing", async () => {
      const renderer = new Renderer({ ...defaultRendererProps, canvas });
      await renderer.ready;
      const lost = vi.fn();
      renderer.addListener("gpuLost", lost);
      renderer.gl.onDeviceLost({ api: "WebGPU", message: "", reason: null, originalEvent: {} });
      expect(lost).toHaveBeenCalledTimes(1);
      const render = vi.spyOn(renderer.gl, "render");
      renderer.animationFrame();
      expect(render).not.toHaveBeenCalled();
      renderer.dispose();
    });
  });

  it("updates color scheme to dark", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const setClearColorSpy = vi.spyOn(renderer.gl, "setClearColor");

    // When: Setting dark color scheme
    renderer.setColorScheme("dark", undefined);

    // Then: Should update color scheme and backdrop
    expect(renderer.colorScheme).toBe("dark");
    expect(setClearColorSpy).toHaveBeenCalled();

    renderer.dispose();
  });

  it("updates color scheme to light", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const setClearColorSpy = vi.spyOn(renderer.gl, "setClearColor");

    // When: Setting light color scheme
    renderer.setColorScheme("light", undefined);

    // Then: Should update color scheme and backdrop
    expect(renderer.colorScheme).toBe("light");
    expect(setClearColorSpy).toHaveBeenCalled();

    renderer.dispose();
  });

  it("sets custom camera models", () => {
    // Given: A renderer instance and custom camera models
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const customModels: CameraModelsMap = new Map();
    customModels.set(BasicBuilder.string(), {
      extensionId: BasicBuilder.string(),
      modelBuilder: vi.fn(),
    });
    customModels.set(BasicBuilder.string(), {
      extensionId: BasicBuilder.string(),
      modelBuilder: vi.fn(),
    });
    // When: Setting custom camera models
    renderer.setCustomCameraModels(customModels);

    // Then: Custom camera models should be set
    expect(renderer.customCameraModels).toBe(customModels);
    expect(renderer.customCameraModels.size).toBe(2);

    renderer.dispose();
  });

  it("updates topics list and emits event", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const emitSpy = vi.spyOn(renderer, "emit");
    const topics = [
      { name: "/test", schemaName: "test_schema" },
      { name: "/other", schemaName: "other_schema" },
    ];

    // When: Setting topics
    renderer.setTopics(topics);

    // Then: Should update topics and emit event
    expect(renderer.topics).toBe(topics);
    expect(renderer.topicsByName?.get("/test")).toEqual(topics[0]);
    expect(emitSpy).toHaveBeenCalledWith("topicsChanged", renderer);

    renderer.dispose();
  });

  it("gets camera state from camera handler", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });

    // When: Getting camera state
    const cameraState = renderer.getCameraState();

    // Then: Should return camera state
    expect(cameraState).toBeDefined();
    expect(cameraState).toHaveProperty("perspective");

    renderer.dispose();
  });

  it("resets view in image mode", () => {
    // Given: A renderer in image mode
    const imageRendererProps = {
      ...defaultRendererProps,
      interfaceMode: "image" as const,
    };
    const renderer = new Renderer({ ...imageRendererProps, canvas });

    // When: Resetting view
    renderer.resetView();

    // Then: Should not throw
    expect(() => {
      renderer.resetView();
    }).not.toThrow();

    renderer.dispose();
  });

  it("sets and clears selected renderable", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const emitSpy = vi.spyOn(renderer, "emit");

    // When: Calling setSelectedRenderable with undefined (no change as it starts undefined)
    renderer.setSelectedRenderable(undefined);

    // Then: Should not emit event (no change)
    expect(emitSpy).not.toHaveBeenCalled();

    renderer.dispose();
  });

  it("selects a renderable and emits event", () => {
    // Given: A renderer instance and a mock renderable
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const mockRenderable = {
      id: "test-id",
      name: "test-name",
      layers: {
        set: vi.fn(),
      },
      traverse: vi.fn(function (callback) {
        // Simulate traversing children
        callback(mockRenderable);
      }),
    };
    const selection = {
      renderable: mockRenderable as any,
      instanceIndex: 0,
    };
    const emitSpy = vi.spyOn(renderer, "emit");
    const animationFrameSpy = vi.spyOn(renderer, "animationFrame");

    // When: Selecting a renderable
    renderer.setSelectedRenderable(selection);

    // Then: Should set layers, emit event, and queue animation frame
    expect(mockRenderable.layers.set).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith("selectedRenderable", selection, renderer);
    expect(animationFrameSpy).toHaveBeenCalled();

    renderer.dispose();
  });

  it("deselects previous renderable when selecting new one", () => {
    // Given: A renderer with a selected renderable
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const firstRenderable = {
      id: "first-id",
      name: "first-name",
      layers: { set: vi.fn() },
      traverse: vi.fn(),
    };
    const secondRenderable = {
      id: "second-id",
      name: "second-name",
      layers: { set: vi.fn() },
      traverse: vi.fn(),
    };
    const firstSelection = { renderable: firstRenderable, instanceIndex: 0 };
    const secondSelection = { renderable: secondRenderable, instanceIndex: 1 };

    // @ts-expect-error - Partial mock for testing
    renderer.setSelectedRenderable(firstSelection);
    firstRenderable.layers.set.mockClear();
    secondRenderable.layers.set.mockClear();

    // When: Selecting a different renderable
    // @ts-expect-error - Partial mock for testing
    renderer.setSelectedRenderable(secondSelection);

    // Then: Should deselect first and select second
    expect(firstRenderable.layers.set).toHaveBeenCalled();
    expect(secondRenderable.layers.set).toHaveBeenCalled();

    renderer.dispose();
  });

  it("deselects renderable when setting to undefined", () => {
    // Given: A renderer with a selected renderable
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const mockRenderable = {
      id: "test-id",
      name: "test-name",
      layers: { set: vi.fn() },
      traverse: vi.fn(),
    };
    const selection = { renderable: mockRenderable, instanceIndex: 0 };
    // @ts-expect-error - Partial mock for testing
    renderer.setSelectedRenderable(selection);
    mockRenderable.layers.set.mockClear();
    const emitSpy = vi.spyOn(renderer, "emit");

    // When: Clearing selection
    renderer.setSelectedRenderable(undefined);

    // Then: Should deselect and emit event
    expect(mockRenderable.layers.set).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith("selectedRenderable", undefined, renderer);

    renderer.dispose();
  });

  it("does not queue animation frame when debugPicking is enabled", () => {
    // Given: A renderer with debugPicking enabled
    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      testOptions: { debugPicking: true },
    });
    const mockRenderable = {
      id: "test-id",
      name: "test-name",
      layers: { set: vi.fn() },
      traverse: vi.fn(),
    };
    const selection = { renderable: mockRenderable, instanceIndex: 0 };
    const animationFrameSpy = vi.spyOn(renderer, "animationFrame");

    // When: Selecting a renderable
    // @ts-expect-error - Partial mock for testing
    renderer.setSelectedRenderable(selection);

    // Then: Should not queue animation frame
    expect(animationFrameSpy).not.toHaveBeenCalled();

    renderer.dispose();
  });

  it("processes batch of message events", () => {
    // Given: A renderer instance with TF subscription
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const messages = [
      createTFMessageEvent("parent1", "child1", 1n, [1n]),
      createTFMessageEvent("parent2", "child2", 2n, [2n]),
    ];

    // When: Adding message events in batch
    renderer.addMessageEventBatch(messages);

    // Then: Should not throw and process messages
    expect(() => {
      renderer.addMessageEventBatch(messages);
    }).not.toThrow();

    renderer.dispose();
  });

  it("processes single message event", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const message = createTFMessageEvent("parent", "child", 1n, [1n]);

    // When: Adding a single message event
    renderer.addMessageEvent(message);

    // Then: Should process message without error
    expect(() => {
      renderer.addMessageEvent(message);
    }).not.toThrow();

    renderer.dispose();
  });

  it("adds message event batch with header frame extraction", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const messages = [
      {
        topic: "/sensor_data",
        receiveTime: fromNanoSec(1n),
        schemaName: "sensor_msgs/Imu",
        message: {
          header: { frame_id: "imu_frame", stamp: fromNanoSec(1n) },
        },
        sizeInBytes: 0,
      },
      {
        topic: "/laser_scan",
        receiveTime: fromNanoSec(2n),
        schemaName: "sensor_msgs/LaserScan",
        message: {
          header: { frame_id: "laser_frame", stamp: fromNanoSec(2n) },
        },
        sizeInBytes: 0,
      },
    ];

    // When: Adding batch with messages containing headers
    renderer.addMessageEventBatch(messages);

    // Then: Should extract frames from all message headers
    expect(renderer.transformTree.hasFrame("imu_frame")).toBe(true);
    expect(renderer.transformTree.hasFrame("laser_frame")).toBe(true);

    renderer.dispose();
  });

  it("adds message event batch with top-level frame_id extraction", () => {
    // Given: A renderer and messages with top-level frame_id
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const messages = [
      {
        topic: "/pose",
        receiveTime: fromNanoSec(1n),
        schemaName: "geometry_msgs/PoseStamped",
        message: {
          frame_id: "world",
        },
        sizeInBytes: 0,
      },
      {
        topic: "/odometry",
        receiveTime: fromNanoSec(2n),
        schemaName: "nav_msgs/Odometry",
        message: {
          frame_id: "odom",
        },
        sizeInBytes: 0,
      },
    ];

    // When: Adding batch with messages containing top-level frame_id
    renderer.addMessageEventBatch(messages);

    // Then: Should extract frames from top-level frame_id fields
    expect(renderer.transformTree.hasFrame("world")).toBe(true);
    expect(renderer.transformTree.hasFrame("odom")).toBe(true);

    renderer.dispose();
  });

  it("queues messages to topic and schema subscriptions", () => {
    // Given: A renderer with subscriptions
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const messages = [
      createTFMessageEvent("parent1", "child1", 1n, [1n], "/tf"),
      createTFMessageEvent("parent2", "child2", 2n, [2n], "/tf"),
      createTFMessageEvent("parent3", "child3", 3n, [3n], "/tf_static"),
    ];

    // When: Adding message event batch
    renderer.addMessageEventBatch(messages);

    // Then: Schema subscriptions should be defined and have queued messages
    const schemaSubscriptions = renderer.schemaSubscriptions.get("tf2_msgs/TFMessage");
    expect(schemaSubscriptions).toBeDefined();
    expect(schemaSubscriptions!.length).toBeGreaterThan(0);

    // Check that messages were queued to at least one subscription
    const hasQueuedMessages = schemaSubscriptions!.some(
      (subscription) => subscription.queue != undefined && subscription.queue.length >= 3,
    );
    expect(hasQueuedMessages).toBe(true);

    renderer.dispose();
  });

  it("disables image only subscription mode and re-enables subscriptions", () => {
    // Given: A renderer in image mode
    const imageRendererProps = {
      ...defaultRendererProps,
      interfaceMode: "image" as const,
    };
    const renderer = new Renderer({ ...imageRendererProps, canvas });

    // When: Disabling image only subscription mode
    renderer.disableImageOnlySubscriptionMode();

    // Then: Should re-enable all subscriptions
    expect(renderer.schemaSubscriptions.size).toBeGreaterThan(0);

    renderer.dispose();
  });

  describe("image-only mode topic settings validator", () => {
    it("adds an IMAGE_ONLY_TOPIC error to visible topics while in image-only mode", () => {
      // Given: A renderer in image mode with image-only subscription mode enabled
      const renderer = new Renderer({
        ...defaultRendererProps,
        interfaceMode: "image" as const,
        canvas,
      });
      renderer.enableImageOnlySubscriptionMode();

      // When: A visible topic node is validated
      renderer.settings.setNodesForKey("test-key", [
        { path: ["topics", "/camera"], node: { visible: true } },
      ]);

      // Then: An error should be added to that topic
      expect(renderer.settings.errors.errors.errorAtPath(["topics", "/camera"])).toBe(
        "Camera calibration information is required to display 3D topics",
      );

      renderer.dispose();
    });

    it("removes the IMAGE_ONLY_TOPIC error when a topic is not visible", () => {
      // Given: A renderer in image mode with image-only subscription mode enabled
      const renderer = new Renderer({
        ...defaultRendererProps,
        interfaceMode: "image" as const,
        canvas,
      });
      renderer.enableImageOnlySubscriptionMode();
      renderer.settings.setNodesForKey("test-key", [
        { path: ["topics", "/camera"], node: { visible: true } },
      ]);
      expect(renderer.settings.errors.errors.errorAtPath(["topics", "/camera"])).toBeDefined();

      // When: The topic becomes not visible
      renderer.settings.setNodesForKey("test-key", [
        { path: ["topics", "/camera"], node: { visible: false } },
      ]);

      // Then: The error should be removed
      expect(renderer.settings.errors.errors.errorAtPath(["topics", "/camera"])).toBeUndefined();

      renderer.dispose();
    });

    it("ignores non-topic paths and topic paths without a topic name", () => {
      // Given: A renderer in image mode with image-only subscription mode enabled
      const renderer = new Renderer({
        ...defaultRendererProps,
        interfaceMode: "image" as const,
        canvas,
      });
      renderer.enableImageOnlySubscriptionMode();

      // When/Then: Validating unrelated or incomplete paths should not throw or add errors
      expect(() => {
        renderer.settings.setNodesForKey("test-key", [
          { path: ["layers"], node: { visible: true } },
          { path: ["topics"], node: { visible: true } },
        ]);
      }).not.toThrow();
      expect(renderer.settings.errors.errors.errorAtPath(["topics"])).toBeUndefined();

      renderer.dispose();
    });
  });

  describe("scene lighting", () => {
    it("switches the main light to a headlight attached to the active camera", () => {
      // Given: A renderer with headlight mode configured
      const renderer = new Renderer({
        ...defaultRendererProps,
        canvas,
        config: {
          ...defaultRendererConfig,
          scene: { mainLightMode: "headlight", directionalLightIntensity: 2 },
        },
      });

      // When: Rendering a frame (which syncs the headlight to the active camera)
      renderer.animationFrame();
      const camera = renderer.cameraHandler.getActiveCamera();

      // Then: The headlight should be attached to the camera with the configured intensity
      const attachedLight = camera.children.find(
        (child: THREE.Object3D): child is THREE.DirectionalLight =>
          child instanceof THREE.DirectionalLight,
      );
      expect(attachedLight).toBeDefined();
      expect(attachedLight?.intensity).toBe(2);

      renderer.dispose();
    });

    it("does not attach a headlight to the camera in fixed lighting mode", () => {
      // Given: A renderer using the default (fixed) lighting mode
      const renderer = new Renderer({ ...defaultRendererProps, canvas });

      // When: Rendering a frame
      renderer.animationFrame();
      const camera = renderer.cameraHandler.getActiveCamera();

      // Then: No directional light should be attached to the camera
      const attachedLight = camera.children.find(
        (child: THREE.Object3D) => child instanceof THREE.DirectionalLight,
      );
      expect(attachedLight).toBeUndefined();

      renderer.dispose();
    });

    it("detaches the headlight from the camera when switching back to fixed mode", () => {
      // Given: A renderer in headlight mode with the headlight synced to the camera
      const renderer = new Renderer({
        ...defaultRendererProps,
        canvas,
        config: {
          ...defaultRendererConfig,
          scene: { mainLightMode: "headlight" },
        },
      });
      renderer.animationFrame();
      const camera = renderer.cameraHandler.getActiveCamera();
      expect(
        camera.children.some((child: THREE.Object3D) => child instanceof THREE.DirectionalLight),
      ).toBe(true);

      // When: Switching back to fixed lighting mode
      renderer.config = {
        ...renderer.config,
        scene: { mainLightMode: "fixed" },
      };
      renderer.updateSceneRenderSettings();

      // Then: The headlight should no longer be attached to the camera
      expect(
        camera.children.some((child: THREE.Object3D) => child instanceof THREE.DirectionalLight),
      ).toBe(false);

      renderer.dispose();
    });

    it("applies configured hemisphere light intensity", async () => {
      // Given: A renderer with a custom hemisphere light intensity
      const renderer = new Renderer({
        ...defaultRendererProps,
        canvas,
        config: {
          ...defaultRendererConfig,
          scene: { hemisphereLightIntensity: 3.5 },
        },
      });
      await renderer.ready;
      const renderSpy = vi.spyOn(renderer.gl, "render");

      // When: Rendering a frame (updateSceneRenderSettings runs during construction and applies
      // the configured intensity; rendering lets us capture the private scene via the gl mock)
      renderer.animationFrame();

      // Then: The hemisphere light in the scene should reflect the configured intensity
      const [scene] = renderSpy.mock.calls[0] as [THREE.Scene, THREE.Camera];
      const hemiLight = scene.children.find(
        (child: THREE.Object3D): child is THREE.HemisphereLight =>
          child instanceof THREE.HemisphereLight,
      );
      expect(hemiLight).toBeDefined();
      expect(hemiLight?.intensity).toBe(3.5);

      renderer.dispose();
    });

    it("applies the default hemisphere light intensity when not configured", async () => {
      // Given: A renderer without a custom hemisphere light intensity
      const renderer = new Renderer({ ...defaultRendererProps, canvas });
      await renderer.ready;
      const renderSpy = vi.spyOn(renderer.gl, "render");

      // When: Rendering a frame
      renderer.animationFrame();

      // Then: The hemisphere light should use the default intensity (0.5 * PI)
      const [scene] = renderSpy.mock.calls[0] as [THREE.Scene, THREE.Camera];
      const hemiLight = scene.children.find(
        (child: THREE.Object3D): child is THREE.HemisphereLight =>
          child instanceof THREE.HemisphereLight,
      );
      expect(hemiLight?.intensity).toBe(0.5 * Math.PI);

      renderer.dispose();
    });
  });

  it("does not update topics when topics reference is the same", () => {
    // Given: A renderer with topics set
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const topics = [{ name: "/test", schemaName: "test_schema" }];
    renderer.setTopics(topics);
    const emitSpy = vi.spyOn(renderer, "emit");

    // When: Setting the same topics reference
    renderer.setTopics(topics);

    // Then: Should not emit topicsChanged event
    expect(emitSpy).not.toHaveBeenCalledWith("topicsChanged", renderer);

    renderer.dispose();
  });

  it("sets parameters and rebuilds settings", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const parameters = new Map([
      ["param1", { type: "string" as const, value: "value1" }],
      ["param2", { type: "number" as const, value: 42 }],
    ]);

    // When: Setting parameters
    renderer.setParameters(parameters);

    // Then: Parameters should be updated
    expect(renderer.parameters).toBe(parameters);
    expect(renderer.parameters?.size).toBe(2);

    renderer.dispose();
  });

  it("adds message event with header frame extraction", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const message = {
      topic: "/test",
      receiveTime: fromNanoSec(1n),
      schemaName: "test_schema",
      message: {
        header: { frame_id: "test_frame", stamp: fromNanoSec(1n) },
      },
      sizeInBytes: 0,
    };

    // When: Adding message with header
    renderer.addMessageEvent(message);

    // Then: Should extract and add coordinate frame
    expect(renderer.transformTree.hasFrame("test_frame")).toBe(true);

    renderer.dispose();
  });

  it("adds message event with marker array extraction", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const message = {
      topic: "/markers",
      receiveTime: fromNanoSec(1n),
      schemaName: "visualization_msgs/MarkerArray",
      message: {
        markers: [
          { header: { frame_id: "marker_frame1", stamp: fromNanoSec(1n) } },
          { header: { frame_id: "marker_frame2", stamp: fromNanoSec(1n) } },
          { header: { frame_id: "marker_frame3", stamp: fromNanoSec(1n) } },
        ],
      },
      sizeInBytes: 0,
    };

    // When: Adding message with marker array
    renderer.addMessageEvent(message);

    // Then: Should extract frames from all markers
    expect(renderer.transformTree.hasFrame("marker_frame1")).toBe(true);
    expect(renderer.transformTree.hasFrame("marker_frame2")).toBe(true);
    expect(renderer.transformTree.hasFrame("marker_frame3")).toBe(true);

    renderer.dispose();
  });

  it("adds message event with entities extraction", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const message = {
      topic: "/entities",
      receiveTime: fromNanoSec(1n),
      schemaName: "foxglove.SceneUpdate",
      message: {
        entities: [
          { frame_id: "entity_frame1" },
          { frame_id: "entity_frame2" },
          { frame_id: "entity_frame3" },
        ],
      },
      sizeInBytes: 0,
    };

    // When: Adding message with entities
    renderer.addMessageEvent(message);

    // Then: Should extract frames from all entities
    expect(renderer.transformTree.hasFrame("entity_frame1")).toBe(true);
    expect(renderer.transformTree.hasFrame("entity_frame2")).toBe(true);
    expect(renderer.transformTree.hasFrame("entity_frame3")).toBe(true);

    renderer.dispose();
  });

  it("adds message event with top-level frame_id extraction", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const message = {
      topic: "/pose",
      receiveTime: fromNanoSec(1n),
      schemaName: "geometry_msgs/PoseStamped",
      message: {
        frame_id: "world",
      },
      sizeInBytes: 0,
    };

    // When: Adding message with top-level frame_id
    renderer.addMessageEvent(message);

    // Then: Should extract frame from top-level frame_id field
    expect(renderer.transformTree.hasFrame("world")).toBe(true);

    renderer.dispose();
  });

  it("adds message event batch with marker array extraction", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const messages = [
      {
        topic: "/markers",
        receiveTime: fromNanoSec(1n),
        schemaName: "visualization_msgs/MarkerArray",
        message: {
          markers: [
            { header: { frame_id: "marker_frame1", stamp: fromNanoSec(1n) } },
            { header: { frame_id: "marker_frame2", stamp: fromNanoSec(1n) } },
          ],
        },
        sizeInBytes: 0,
      },
    ];

    // When: Adding batch with marker array
    renderer.addMessageEventBatch(messages);

    // Then: Should extract frames from all markers
    expect(renderer.transformTree.hasFrame("marker_frame1")).toBe(true);
    expect(renderer.transformTree.hasFrame("marker_frame2")).toBe(true);

    renderer.dispose();
  });

  it("adds message event batch with entities extraction", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const messages = [
      {
        topic: "/entities",
        receiveTime: fromNanoSec(1n),
        schemaName: "foxglove.SceneUpdate",
        message: {
          entities: [{ frame_id: "entity_frame1" }, { frame_id: "entity_frame2" }],
        },
        sizeInBytes: 0,
      },
    ];

    // When: Adding batch with entities
    renderer.addMessageEventBatch(messages);

    // Then: Should extract frames from all entities
    expect(renderer.transformTree.hasFrame("entity_frame1")).toBe(true);
    expect(renderer.transformTree.hasFrame("entity_frame2")).toBe(true);

    renderer.dispose();
  });

  it("normalizes frame IDs by stripping leading slashes in ROS mode", () => {
    // Given: A renderer with ROS mode enabled
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    renderer.ros = true;

    // When: Normalizing frame IDs with leading slashes
    const normalized1 = renderer.normalizeFrameId("/map");
    const normalized2 = renderer.normalizeFrameId("/base_link");
    const normalized3 = renderer.normalizeFrameId("no_slash");

    // Then: Leading slashes should be stripped
    expect(normalized1).toBe("map");
    expect(normalized2).toBe("base_link");
    expect(normalized3).toBe("no_slash");

    renderer.dispose();
  });

  it("does not normalize frame IDs when not in ROS mode", () => {
    // Given: A renderer with ROS mode disabled
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    renderer.ros = false;

    // When: Normalizing frame IDs with leading slashes
    const normalized = renderer.normalizeFrameId("/map");

    // Then: Leading slashes should not be stripped
    expect(normalized).toBe("/map");

    renderer.dispose();
  });

  it("adds coordinate frame and emits transformTreeUpdated", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const emitSpy = vi.spyOn(renderer, "emit");

    // When: Adding a new coordinate frame
    renderer.addCoordinateFrame("test_frame");

    // Then: Frame should be added and event emitted
    expect(renderer.transformTree.hasFrame("test_frame")).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith("transformTreeUpdated", renderer);

    renderer.dispose();
  });

  it("does not re-add existing coordinate frame", () => {
    // Given: A renderer with an existing frame
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    renderer.addCoordinateFrame("existing_frame");
    const emitSpy = vi.spyOn(renderer, "emit");

    // When: Trying to add the same frame again
    renderer.addCoordinateFrame("existing_frame");

    // Then: Event should not be emitted
    expect(emitSpy).not.toHaveBeenCalledWith("transformTreeUpdated", renderer);

    renderer.dispose();
  });

  it("removes transform and updates coordinate frame list", () => {
    // Given: A renderer with a transform
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    renderer.addTransform("parent", "child", 1n, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    const emitSpy = vi.spyOn(renderer, "emit");

    // When: Removing the transform
    renderer.removeTransform("child", "parent", 1n);

    // Then: Transform should be removed and event emitted
    expect(emitSpy).toHaveBeenCalledWith("transformTreeUpdated", renderer);

    renderer.dispose();
  });

  it("detects and reports transform tree cycles", () => {
    // Given: A renderer with a transform chain: grandparent -> parent -> child
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    renderer.addTransform(
      "grandparent",
      "parent",
      1n,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
    );
    renderer.addTransform("parent", "child", 1n, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });

    // When: Attempting to create a cycle by making grandparent a child of child
    renderer.addTransform(
      "child",
      "grandparent",
      1n,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
    );

    // Then: Should add cycle detection error
    const cycleError = renderer.settings.errors.errors.errorAtPath([
      "transforms",
      "frame:grandparent",
    ]);
    expect(cycleError).toBeDefined();
    expect(cycleError).toContain("Transform tree cycle detected");
    expect(cycleError).toContain('parent "child"');
    expect(cycleError).toContain('child "grandparent"');

    renderer.dispose();
  });

  it("reports cycle detection error with custom settings path", () => {
    // Given: A renderer with a transform chain
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    renderer.addTransform("parent", "child", 1n, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });

    // When: Attempting to create a cycle with a custom error settings path
    const customErrorPath = ["custom", "error", "path"];
    renderer.addTransform(
      "child",
      "parent",
      1n,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
      customErrorPath,
    );

    // Then: Should add cycle error to both default and custom paths
    const defaultPathError = renderer.settings.errors.errors.errorAtPath([
      "transforms",
      "frame:parent",
    ]);
    expect(defaultPathError).toBeDefined();

    const customPathError = renderer.settings.errors.errors.errorAtPath(customErrorPath);
    expect(customPathError).toBeDefined();
    expect(customPathError).toContain("Attempted to add cyclical transform");

    renderer.dispose();
  });

  it("returns cannot drop status when no extension supports path", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const paths: DraggedMessagePath[] = [
      {
        path: "/unsupported/path",
        isTopic: BasicBuilder.boolean(),
        isLeaf: BasicBuilder.boolean(),
        topicName: BasicBuilder.string(),
        rootSchemaName: undefined,
      },
    ];

    // When: Getting drop status for unsupported path
    const status = renderer.getDropStatus(paths);

    // Then: Should return cannot drop
    expect(status.canDrop).toBe(false);

    renderer.dispose();
  });

  it("handles drop by updating config through extensions", () => {
    // Given: A renderer instance
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const paths: DraggedMessagePath[] = [
      {
        path: "/test/path",
        isTopic: BasicBuilder.boolean(),
        isLeaf: BasicBuilder.boolean(),
        topicName: BasicBuilder.string(),
        rootSchemaName: undefined,
      },
    ];
    const updateConfigSpy = vi.spyOn(renderer, "updateConfig");

    // When: Handling drop
    renderer.handleDrop(paths);

    // Then: Should update config
    expect(updateConfigSpy).toHaveBeenCalled();

    renderer.dispose();
  });

  it("offers quick filters for supported topic types and converted schemas", () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    renderer.setTopics([
      { name: "/points", schemaName: "sensor_msgs/msg/PointCloud2" },
      { name: "/image", schemaName: "custom.Image", convertibleTo: ["foxglove.RawImage"] },
      { name: "/markers", schemaName: "foxglove.SceneUpdate" },
      { name: "/other", schemaName: "custom.Other" },
    ]);

    expect(
      renderer.settings.tree().topics?.topicQuickFilters?.map(({ id, topics }) => [id, topics]),
    ).toEqual([
      ["pointClouds", ["/points"]],
      ["images", ["/image"]],
      ["markers", ["/markers"]],
    ]);
    renderer.setTopics([]);
    expect(renderer.settings.tree().topics?.topicQuickFilters).toEqual([]);

    renderer.dispose();
  });

  it("turns on a dropped topic the scene can draw, like its visibility checkbox", () => {
    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: { ...defaultRendererConfig, topics: { "/markers": { visible: false } } },
    });
    renderer.setTopics([
      { name: "/markers", schemaName: "visualization_msgs/MarkerArray" },
      { name: "/objects", schemaName: "custom.Objects", convertibleTo: ["foxglove.SceneUpdate"] },
    ]);
    const markers: DraggedMessagePath = {
      path: "/markers",
      isTopic: true,
      isLeaf: false,
      topicName: "/markers",
      rootSchemaName: "visualization_msgs/MarkerArray",
    };

    expect(renderer.getDropStatus([markers])).toEqual({ canDrop: true, effect: "add" });
    // A field of the topic isn't a topic to turn on
    expect(
      renderer.getDropStatus([{ ...markers, path: "/markers.markers", isTopic: false }]),
    ).toEqual({ canDrop: false });

    // A topic converted to a schema the scene draws counts too
    const objects = { ...markers, path: "/objects", topicName: "/objects" };
    expect(renderer.getDropStatus([{ ...objects, rootSchemaName: "custom.Objects" }])).toEqual({
      canDrop: true,
      effect: "add",
    });

    renderer.handleDrop([markers]);
    expect(renderer.config.topics["/markers"]?.visible).toBe(true);
    // The settings tree shows the topic as visible too
    const topicNodes = renderer.settings.tree().topics?.children;
    expect(topicNodes?.["/markers"]?.visible).toBe(true);

    renderer.dispose();
  });

  it("does not set a unfollow pose snapshot  when in follow-pose mode", () => {
    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...defaultRendererConfig,
        followMode: "follow-pose",
        followTf: "display",
        scene: { transforms: { enablePreloading: false } },
      },
    });
    const cameraState = renderer.sceneExtensions.get(
      "foxglove.CameraStateSettings",
    ) as CameraStateSettings;

    renderer.setCurrentTime(1n);

    const tfWithDisplayParent = createTFMessageEvent("display", "childOfDisplay", 1n, [1n]);
    renderer.addMessageEvent(tfWithDisplayParent);
    renderer.animationFrame();

    // record to make sure it changes when there's a new fixed frame
    const tfWithDisplayChild = createTFMessageEvent("parentOfDisplay", "display", 1n, [1n]);
    tfWithDisplayChild.message.transforms[0]!.transform.translation.x = 1;
    renderer.addMessageEvent(tfWithDisplayChild);
    renderer.animationFrame();
    expect(cameraState.unfollowPoseSnapshot).toBeUndefined();
  });
  it("records pose snapshot after changing from follow-pose mode to follow-none", () => {
    const config = {
      ...defaultRendererConfig,
      followMode: "follow-pose" as const,
      followTf: "display",
      scene: { transforms: { enablePreloading: false } },
    };
    const renderer = new Renderer({ ...defaultRendererProps, canvas, config });
    const cameraState = renderer.sceneExtensions.get(
      "foxglove.CameraStateSettings",
    ) as CameraStateSettings;

    renderer.setCurrentTime(1n);

    const tfWithDisplayParent = createTFMessageEvent("display", "childOfDisplay", 1n, [1n]);
    renderer.addMessageEvent(tfWithDisplayParent);
    renderer.animationFrame();

    // record to make sure it changes when there's a new fixed frame
    const tfWithDisplayChild = createTFMessageEvent("parentOfDisplay", "display", 1n, [1n]);
    tfWithDisplayChild.message.transforms[0]!.transform.translation.x = 1;
    renderer.addMessageEvent(tfWithDisplayChild);
    renderer.animationFrame();
    expect(cameraState.unfollowPoseSnapshot).toBeUndefined();
    renderer.config = { ...config, followMode: "follow-none" };
    renderer.animationFrame();
    // parent is the camera group that holds the pose from the snapshot
    expect(cameraState.unfollowPoseSnapshot?.position).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
  });
  it("sets pose snapshot to undefined after changing from follow-none mode to follow-pose", () => {
    const config = {
      ...defaultRendererConfig,
      followMode: "follow-none" as const,
      followTf: "display",
      scene: { transforms: { enablePreloading: false } },
    };
    const renderer = new Renderer({ ...defaultRendererProps, canvas, config });
    const cameraState = renderer.sceneExtensions.get(
      "foxglove.CameraStateSettings",
    ) as CameraStateSettings;

    renderer.setCurrentTime(1n);

    const tfWithDisplayParent = createTFMessageEvent("display", "childOfDisplay", 1n, [1n]);
    renderer.addMessageEvent(tfWithDisplayParent);
    renderer.animationFrame();

    // record to make sure it changes when there's a new fixed frame
    const tfWithDisplayChild = createTFMessageEvent("parentOfDisplay", "display", 1n, [1n]);
    tfWithDisplayChild.message.transforms[0]!.transform.translation.x = 1;
    renderer.addMessageEvent(tfWithDisplayChild);
    renderer.animationFrame();
    expect(cameraState.unfollowPoseSnapshot?.position).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
    renderer.config = { ...config, followMode: "follow-pose" };
    renderer.animationFrame();
    expect(cameraState.unfollowPoseSnapshot).toBeUndefined();
  });
  it("keeps same unfollowPoseSnapshot when switching from follow-none to follow-position", () => {
    const config = {
      ...defaultRendererConfig,
      followMode: "follow-none" as const,
      followTf: "display",
      scene: { transforms: { enablePreloading: false } },
    };
    const renderer = new Renderer({ ...defaultRendererProps, canvas, config });
    const cameraState = renderer.sceneExtensions.get(
      "foxglove.CameraStateSettings",
    ) as CameraStateSettings;

    renderer.setCurrentTime(1n);

    const tfWithDisplayParent = createTFMessageEvent("display", "childOfDisplay", 1n, [1n]);
    renderer.addMessageEvent(tfWithDisplayParent);
    renderer.animationFrame();

    // record to make sure it changes when there's a new fixed frame
    const tfWithDisplayChild = createTFMessageEvent("parentOfDisplay", "display", 1n, [1n]);
    tfWithDisplayChild.message.transforms[0]!.transform.translation.x = 1;
    renderer.addMessageEvent(tfWithDisplayChild);
    renderer.animationFrame();
    expect(cameraState.unfollowPoseSnapshot?.position).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
    renderer.config = { ...config, followMode: "follow-position" };
    renderer.animationFrame();
    expect(cameraState.unfollowPoseSnapshot?.position).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
  });
  it("in fixed follow mode: ensures that the unfollowPoseSnapshot updates when there is a new fixedFrame", () => {
    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...defaultRendererConfig,
        followMode: "follow-none",
        followTf: "display",
        scene: { transforms: { enablePreloading: false } },
      },
    });
    const cameraState = renderer.sceneExtensions.get(
      "foxglove.CameraStateSettings",
    ) as CameraStateSettings;

    renderer.setCurrentTime(1n);

    const tfWithDisplayParent = createTFMessageEvent("display", "childOfDisplay", 1n, [1n]);
    renderer.addMessageEvent(tfWithDisplayParent);
    renderer.animationFrame();

    // record to make sure it changes when there's a new fixed frame
    const tfWithDisplayChild = createTFMessageEvent("parentOfDisplay", "display", 1n, [1n]);
    tfWithDisplayChild.message.transforms[0]!.transform.translation.x = 1;
    renderer.addMessageEvent(tfWithDisplayChild);
    renderer.animationFrame();
    expect(renderer.fixedFrameId).toEqual("parentOfDisplay");
    expect(cameraState.unfollowPoseSnapshot?.position).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });

    const tfWithFinalRoot = createTFMessageEvent("root", "parentOfDisplay", 1n, [1n]);
    tfWithFinalRoot.message.transforms[0]!.transform.translation.y = 1;
    renderer.addMessageEvent(tfWithFinalRoot);
    renderer.animationFrame();
    expect(renderer.fixedFrameId).toEqual("root");
    // combines the two translations
    expect(cameraState.unfollowPoseSnapshot?.position).toEqual({
      x: 1,
      y: 1,
      z: 0,
    });
  });
  it("tfPreloading off:  when seeking to before currentTime, clears transform tree", () => {
    // This test is meant accurately represent the flow of seek through the react component

    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: false } },
      },
    });
    let currentFrame = [];

    // initialize renderer with transforms

    // first frame
    let currentTime = 5n;
    const beforeHeader = createTFMessageEvent("root", "before", currentTime, [currentTime - 2n]);
    // transform with headerstamp before currentTime
    currentFrame = [beforeHeader];
    renderer.setCurrentTime(currentTime);
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });

    // second frame
    currentTime = 6n;
    const onHeader = createTFMessageEvent("root", "on", currentTime, [currentTime]);
    // transform with headerstamp on currentTime
    currentFrame = [onHeader];
    renderer.setCurrentTime(currentTime);
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });

    // third frame
    currentTime = 7n;
    const afterHeader = createTFMessageEvent("root", "after", currentTime, [currentTime + 2n]);
    // transform with headerstamp after currentTime
    currentFrame = [afterHeader];
    renderer.setCurrentTime(currentTime);
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });
    // messages processed by renderer on animation frame
    renderer.animationFrame();

    expect(renderer.transformTree.frame("before")).not.toBeUndefined();
    expect(renderer.transformTree.frame("on")).not.toBeUndefined();
    expect(renderer.transformTree.frame("after")).not.toBeUndefined();

    //seek to 5n

    const oldTime = currentTime;
    currentTime = 5n;
    renderer.setCurrentTime(currentTime);
    renderer.handleSeek(oldTime);
    // should have cleared transforms so that no future-to-the-currentTime transforms are in the tree
    expect(renderer.transformTree.frame("before")).toBeUndefined();
    expect(renderer.transformTree.frame("on")).toBeUndefined();
    expect(renderer.transformTree.frame("after")).toBeUndefined();
    // currentFrame will be set back to what it was at that time
    currentFrame = [beforeHeader];
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });
    // messages processed by renderer on animation frame
    renderer.animationFrame();

    expect(renderer.transformTree.frame("before")).not.toBeUndefined();
  });
  it("tfPreloading off: when seeking to time after currentTime, does not clear transform tree", () => {
    // This test is meant accurately represent the flow of seek through the react component

    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: false } },
      },
    });
    let currentFrame = [];

    // initialize renderer with transforms

    // first frame
    let currentTime = 5n;
    const beforeHeader = createTFMessageEvent("root", "before", currentTime, [currentTime - 2n]);
    // transform with headerstamp before currentTime
    currentFrame = [beforeHeader];
    renderer.setCurrentTime(currentTime);
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });

    // second frame
    currentTime = 6n;
    const onHeader = createTFMessageEvent("root", "on", currentTime, [currentTime]);
    // transform with headerstamp on currentTime
    currentFrame = [onHeader];
    renderer.setCurrentTime(currentTime);
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });

    // third frame
    currentTime = 7n;
    const afterHeader = createTFMessageEvent("root", "after", currentTime, [currentTime + 2n]);
    // transform with headerstamp after currentTime
    currentFrame = [afterHeader];
    renderer.setCurrentTime(currentTime);
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });
    // messages processed by renderer on animation frame
    renderer.animationFrame();

    expect(renderer.transformTree.frame("before")).not.toBeUndefined();
    expect(renderer.transformTree.frame("on")).not.toBeUndefined();
    expect(renderer.transformTree.frame("after")).not.toBeUndefined();

    //seek to 10n (forward)

    const oldTime = currentTime;
    currentTime = 10n;
    renderer.setCurrentTime(currentTime);
    renderer.handleSeek(oldTime);
    // should not have cleared transforms
    expect(renderer.transformTree.frame("before")).not.toBeUndefined();
    expect(renderer.transformTree.frame("on")).not.toBeUndefined();
    expect(renderer.transformTree.frame("after")).not.toBeUndefined();
    // currentFrame will be set back to what it was at that time
    const seekOnHeader = createTFMessageEvent("root", "seekOn", currentTime, [currentTime]);
    currentFrame = [seekOnHeader];
    currentFrame.forEach((msg) => {
      renderer.addMessageEvent(msg);
    });
    // messages processed by renderer on animation frame
    renderer.animationFrame();

    expect(renderer.transformTree.frame("before")).not.toBeUndefined();
    expect(renderer.transformTree.frame("on")).not.toBeUndefined();
    expect(renderer.transformTree.frame("after")).not.toBeUndefined();
    expect(renderer.transformTree.frame("seekOn")).not.toBeUndefined();
  });
  it("tfPreloading on: keeps the complete history across seeks and shows what was received by then", () => {
    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: true } },
      },
    });
    const history = [
      createTFMessageEvent("root", "before4", 5n, [1n]),
      createTFMessageEvent("root", "before2", 6n, [4n]),
      createTFMessageEvent("root", "on", 7n, [7n]),
      createTFMessageEvent("root", "after2", 8n, [10n]),
      createTFMessageEvent("root", "after4", 9n, [13n]),
    ];
    const placed = (frameId: string) =>
      renderer.transformTree.apply(
        makePose(),
        makePose(),
        "root",
        undefined,
        frameId,
        renderer.currentTime,
        renderer.currentTime,
      ) != undefined;

    renderer.transformTree.setComplete(true);
    renderer.addTransformMessages(history);
    renderer.setCurrentTime(8n);
    renderer.animationFrame();
    expect(["before4", "before2", "on", "after2", "after4"].map(placed)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);

    // Seeking back keeps the history but hides what was received later
    renderer.setCurrentTime(6n);
    renderer.handleSeek(8n);
    expect(renderer.transformTree.frame("after4")?.transformsSize()).toBe(1);
    expect(["before4", "before2", "on", "after2", "after4"].map(placed)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);

    // Seeking forward shows everything received by then without reading anything again
    renderer.setCurrentTime(9n);
    renderer.handleSeek(6n);
    expect(["before4", "before2", "on", "after2", "after4"].map(placed)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe("Renderer.addTransformMessages", () => {
  let canvas = document.createElement("canvas");
  beforeEach(() => {
    vi.clearAllMocks();
    setupVitestCanvasMock();
    const parent = document.createElement("div");
    canvas = document.createElement("canvas");
    parent.appendChild(canvas);
  });
  afterEach(() => {
    (console.warn as Mock).mockClear();
  });

  it("adds every transform straight to the tree, announcing the tree change once", () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const updates = vi.fn();
    renderer.on("transformTreeUpdated", updates);
    renderer.addTransformMessages([
      createTFMessageEvent("root", "a", 1n, [1n, 2n]),
      createTFMessageEvent("root", "b", 2n, [2n]),
    ]);
    expect(renderer.transformTree.frame("a")?.transformsSize()).toBe(2);
    expect(renderer.transformTree.frame("b")?.transformsSize()).toBe(1);
    expect(updates).toHaveBeenCalledTimes(1);
  });

  it("repaints for history batches at most every 250 ms, plus once after the last", () => {
    vi.useFakeTimers();
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const queue = vi.spyOn(renderer, "queueAnimationFrame").mockImplementation(() => {});
    renderer.currentTime = 10n;

    // Any batch can change what is on screen, also one received after the current time
    renderer.addTransformMessages([createTFMessageEvent("root", "a", 11n, [11n])]);
    renderer.addTransformMessages([createTFMessageEvent("root", "a", 5n, [5n])]);
    renderer.addTransformMessages([createTFMessageEvent("root", "a", 6n, [6n])]);
    expect(queue).toHaveBeenCalledTimes(1);

    // One trailing repaint shows the batches that waited
    vi.advanceTimersByTime(250);
    expect(queue).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(queue).toHaveBeenCalledTimes(2);

    // An empty batch changes nothing
    renderer.addTransformMessages([]);
    expect(queue).toHaveBeenCalledTimes(2);

    renderer.dispose();
    vi.useRealTimers();
  });

  it("reports which frames the messages gave a transform", () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const touched = new Set<string>();
    renderer.addTransformMessages([createTFMessageEvent("root", "a", 1n, [5n])], touched);
    expect([...touched]).toEqual(["a"]);
  });

  it("does not report a frame whose transform was rejected as a cycle", () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    renderer.addTransformMessages([createTFMessageEvent("a", "b", 1n, [1n])]);
    const touched = new Set<string>();
    // a under b would close a cycle with b under a; the stamp also differs from the receive time
    renderer.addTransformMessages([createTFMessageEvent("b", "a", 97n, [99n])], touched);
    renderer.addTransformMessages([createTFMessageEvent("a", "c", 98n, [95n])], touched);
    expect([...touched]).toEqual(["c"]);
  });

  it("drops cached static transforms of removed topics when the history starts over", () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    renderer.setCurrentTime(100n);
    renderer.addTransformMessages([
      createTFMessageEvent("root", "kept", 1n, [1n], "/tf_static"),
      createTFMessageEvent("root", "removed", 1n, [1n], "/old_tf_static"),
    ]);

    renderer.resetTransformHistory(new Set(["/tf_static"]));
    expect(renderer.transformTree.frame("kept")?.transformsSize()).toBe(1);
    expect(renderer.transformTree.frame("removed")).toBeUndefined();

    // A later backward seek must not bring it back from the cache
    renderer.setCurrentTime(50n);
    renderer.handleSeek(100n);
    expect(renderer.transformTree.frame("removed")).toBeUndefined();
    expect(renderer.transformTree.frame("kept")).toBeDefined();
  });

  it("announces the cleared tree on a backward seek without static transforms", () => {
    // The panel reads the thinning count from the tree on this event
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    renderer.setCurrentTime(100n);
    renderer.addTransform("root", "a", 90n, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    const updates = vi.fn();
    renderer.on("transformTreeUpdated", updates);

    renderer.setCurrentTime(50n);
    renderer.handleSeek(100n);

    expect(renderer.transformTree.frame("a")).toBeUndefined();
    expect(updates).toHaveBeenCalledTimes(1);
  });

  it("is idempotent for transforms read twice", () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const batch = [createTFMessageEvent("root", "a", 1n, [1n, 2n])];
    renderer.addTransformMessages(batch);
    renderer.addTransformMessages(batch);
    expect(renderer.transformTree.frame("a")?.transformsSize()).toBe(2);
  });
});

describe("Renderer backward seek behavior", () => {
  let canvas = document.createElement("canvas");
  let parent = document.createElement("div");
  let rendererArgs: ConstructorParameters<typeof Renderer>[0] = {
    ...defaultRendererProps,
    canvas,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupVitestCanvasMock();
    parent = document.createElement("div");
    canvas = document.createElement("canvas");
    parent.appendChild(canvas);
    rendererArgs = { ...defaultRendererProps, canvas };
  });

  afterEach(() => {
    (console.warn as Mock).mockClear();
  });

  it("clears transforms correctly when seeking backward without preload", () => {
    // Given: A renderer without preload
    const renderer = new Renderer({
      ...rendererArgs,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: false } },
      },
    });

    // When: Adding transforms and seeking backward
    renderer.setCurrentTime(100n);
    const msg = createTFMessageEvent("parent", "child", 50n, [50n]);
    renderer.addMessageEvent(msg);
    renderer.animationFrame();

    // When: Seeking backward should clear transforms
    renderer.setCurrentTime(10n);
    renderer.handleSeek(100n);

    // Then: Transform tree should be cleared (no transforms)
    const frame = renderer.transformTree.frame("child");
    // Frame may exist but should have no transforms, or frame doesn't exist (both are valid)
    expect(frame == undefined || frame.transformsSize() === 0).toBe(true);
  });

  it("preserves static transforms when seeking backward", () => {
    // Given: A renderer
    const renderer = new Renderer({
      ...rendererArgs,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: false } },
      },
    });

    // When: Adding regular and static transforms
    renderer.setCurrentTime(100n);
    const regularMsg = createTFMessageEvent("parent", "child_regular", 50n, [50n]);
    const staticMsg = createTFMessageEvent("parent", "child_static", 10n, [10n], "/tf_static");
    renderer.addMessageEvent(regularMsg);
    renderer.addMessageEvent(staticMsg);
    renderer.animationFrame();

    // Verify both are present
    expect(renderer.transformTree.frame("child_regular")?.transformsSize()).toBe(1);
    expect(renderer.transformTree.frame("child_static")?.transformsSize()).toBe(1);

    // When: Seeking backward
    renderer.setCurrentTime(20n);
    renderer.handleSeek(100n);

    // Then: Regular transform should be cleared, static transform preserved
    const regularFrame = renderer.transformTree.frame("child_regular");
    expect(regularFrame == undefined || regularFrame.transformsSize() === 0).toBe(true);
    expect(renderer.transformTree.frame("child_static")?.transformsSize()).toBe(1);
  });

  it("preserves static transforms when seeking backward with preloading enabled", () => {
    // Given: A renderer with preload enabled
    const renderer = new Renderer({
      ...rendererArgs,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: true } },
      },
    });

    // When: Adding regular and static transforms
    renderer.setCurrentTime(100n);
    const regularMsg = createTFMessageEvent("parent", "child_regular", 50n, [50n]);
    const staticMsg = createTFMessageEvent("parent", "child_static", 10n, [10n], "/tf_static");

    renderer.addMessageEvent(regularMsg);
    renderer.addMessageEvent(staticMsg);
    renderer.animationFrame();

    // Verify both are present
    expect(renderer.transformTree.frame("child_regular")?.transformsSize()).toBe(1);
    expect(renderer.transformTree.frame("child_static")?.transformsSize()).toBe(1);

    // When: Seeking backward
    renderer.setCurrentTime(20n);
    renderer.handleSeek(100n);

    // Then: Regular transform (at 50n) should be cleared, static transform preserved
    const regularFrame = renderer.transformTree.frame("child_regular");
    expect(regularFrame == undefined || regularFrame.transformsSize() === 0).toBe(true);
    expect(renderer.transformTree.frame("child_static")?.transformsSize()).toBe(1);
  });

  describe("with preloaded transforms whose header stamps and receive times use different clocks", () => {
    type ClockScenario = { name: string; receiveBase: bigint; stampBase: bigint };

    const equalClocks: ClockScenario = {
      name: "stamps equal receive time",
      receiveBase: 1_000n,
      stampBase: 1_000n,
    };
    const laggingStamps: ClockScenario = {
      name: "stamps lag receive time",
      receiveBase: 1_000_000n,
      stampBase: 500_000n,
    };
    const leadingStamps: ClockScenario = {
      name: "stamps lead receive time",
      receiveBase: 1_000n,
      stampBase: 5_000n,
    };
    const bootRelativeStamps: ClockScenario = {
      name: "stamps are boot-relative and receive time is wall-clock",
      receiveBase: 1_765_000_000_000_000_000n,
      stampBase: 0n,
    };
    const clockScenarios = [equalClocks, laggingStamps, leadingStamps, bootRelativeStamps];
    // Lookups clamp to the earliest entry when stamps lead the query time, so the pose is ambiguous
    const poseScenarios = [equalClocks, laggingStamps, bootRelativeStamps];

    const MESSAGE_COUNT = 10;
    const SPACING_NS = 10n;
    const SEEK_INDEX = 3;

    const lastReceiveTime = ({ receiveBase }: ClockScenario): bigint =>
      receiveBase + BigInt(MESSAGE_COUNT - 1) * SPACING_NS;
    const seekReceiveTime = ({ receiveBase }: ClockScenario): bigint =>
      receiveBase + BigInt(SEEK_INDEX) * SPACING_NS;

    // Message i moves "ego" to x = i so the pose identifies which message was applied last
    const createEgoTransformEvents = ({ receiveBase, stampBase }: ClockScenario) =>
      Array.from({ length: MESSAGE_COUNT }, (_, i) => {
        const offset = BigInt(i) * SPACING_NS;
        const event = createTFMessageEvent("root", "ego", receiveBase + offset, [
          stampBase + offset,
        ]);
        event.message.transforms[0]!.transform.translation.x = i;
        return event;
      });

    const createPreloadingRenderer = (): Renderer =>
      new Renderer({
        ...rendererArgs,
        config: {
          ...defaultRendererConfig,
          scene: { transforms: { enablePreloading: true } },
        },
      });

    // Mirrors ThreeDeeRender: the whole history is preloaded into a complete tree
    const playTo = (renderer: Renderer, history: readonly MessageEvent[], timeNs: bigint) => {
      renderer.transformTree.setComplete(true);
      renderer.addTransformMessages(history);
      renderer.setCurrentTime(timeNs);
      renderer.animationFrame();
    };

    const seekBackTo = (renderer: Renderer, timeNs: bigint) => {
      const oldTimeNs = renderer.currentTime;
      renderer.setCurrentTime(timeNs);
      renderer.handleSeek(oldTimeNs);
      renderer.animationFrame();
    };

    // Header stamp of the newest transform the "ego" frame shows
    const latestVisibleStamp = (renderer: Renderer): bigint | undefined => {
      const lower: [bigint, Transform] = [0n, Transform.Identity()];
      const upper: [bigint, Transform] = [0n, Transform.Identity()];
      const found = renderer.transformTree
        .frame("ego")
        ?.findClosestTransforms(lower, upper, 2n ** 62n, 2n ** 62n);
      return found === true ? upper[0] : undefined;
    };

    const egoPositionX = (renderer: Renderer): number | undefined =>
      renderer.transformTree.apply(
        makePose(),
        makePose(),
        "root",
        undefined,
        "ego",
        renderer.currentTime,
        renderer.currentTime,
      )?.position.x;

    it.each(clockScenarios)(
      "shows only the transforms received up to the seek time when $name",
      (scenario) => {
        // Given: Preloaded transforms played to the end
        const allFrames = createEgoTransformEvents(scenario);
        const renderer = createPreloadingRenderer();
        playTo(renderer, allFrames, lastReceiveTime(scenario));

        // When: Seeking backward to the receive time of the 4th message
        seekBackTo(renderer, seekReceiveTime(scenario));

        // Then: The newest transform shown is the fourth message's
        expect(latestVisibleStamp(renderer)).toBe(
          scenario.stampBase + BigInt(SEEK_INDEX) * SPACING_NS,
        );
      },
    );

    it.each(poseScenarios)(
      "places the frame at its pose at the seek time when $name",
      (scenario) => {
        // Given: Preloaded transforms played to the end
        const allFrames = createEgoTransformEvents(scenario);
        const renderer = createPreloadingRenderer();
        playTo(renderer, allFrames, lastReceiveTime(scenario));

        // When: Seeking backward to the receive time of the 4th message
        seekBackTo(renderer, seekReceiveTime(scenario));

        // Then: The frame is at the 4th message's pose, not the latest one
        expect(egoPositionX(renderer)).toBeCloseTo(SEEK_INDEX);
      },
    );

    it("hides every dynamic transform when seeking before the first message and stamps are boot-relative", () => {
      // Given: Preloaded transforms played to the end
      const allFrames = createEgoTransformEvents(bootRelativeStamps);
      const renderer = createPreloadingRenderer();
      playTo(renderer, allFrames, lastReceiveTime(bootRelativeStamps));

      // When: Seeking backward to before the first message was received
      seekBackTo(renderer, bootRelativeStamps.receiveBase - 1n);

      // Then: No transform from the future is shown
      expect(latestVisibleStamp(renderer)).toBeUndefined();
      expect(egoPositionX(renderer)).toBeUndefined();
    });
  });
});

describe("Renderer static transform caching across message types", () => {
  let canvas = document.createElement("canvas");
  let parent = document.createElement("div");
  let rendererArgs: ConstructorParameters<typeof Renderer>[0] = {
    ...defaultRendererProps,
    canvas,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupVitestCanvasMock();
    parent = document.createElement("div");
    canvas = document.createElement("canvas");
    parent.appendChild(canvas);
    rendererArgs = { ...defaultRendererProps, canvas };
  });

  afterEach(() => {
    (console.warn as Mock).mockClear();
  });

  it("caches and preserves static transforms received as foxglove.FrameTransform messages", () => {
    // Given: A renderer that has received a regular and a static foxglove.FrameTransform message
    const renderer = new Renderer({
      ...rendererArgs,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: false } },
      },
    });
    renderer.setCurrentTime(100n);
    const regularMsg = createFrameTransformEvent("parent", "child_regular", 50n, 50n, "/tf");
    const staticMsg = createFrameTransformEvent("parent", "child_static", 10n, 10n, "/tf_static");
    renderer.addMessageEvent(regularMsg);
    renderer.addMessageEvent(staticMsg);
    renderer.animationFrame();

    // Then: Both transforms should be present before seeking
    expect(renderer.transformTree.frame("child_regular")?.transformsSize()).toBe(1);
    expect(renderer.transformTree.frame("child_static")?.transformsSize()).toBe(1);

    // When: Seeking backward
    renderer.setCurrentTime(20n);
    renderer.handleSeek(100n);

    // Then: The regular transform should be cleared, but the static transform preserved
    const regularFrame = renderer.transformTree.frame("child_regular");
    expect(regularFrame == undefined || regularFrame.transformsSize() === 0).toBe(true);
    expect(renderer.transformTree.frame("child_static")?.transformsSize()).toBe(1);

    renderer.dispose();
  });

  it("caches and preserves static transforms received as foxglove.FrameTransforms messages", () => {
    // Given: A renderer that has received a regular and a static foxglove.FrameTransforms message
    const renderer = new Renderer({
      ...rendererArgs,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: false } },
      },
    });
    renderer.setCurrentTime(100n);
    const regularMsg = createFrameTransformsEvent(
      [{ parentId: "parent", childId: "child_regular", stamp: 50n }],
      50n,
      "/tf",
    );
    const staticMsg = createFrameTransformsEvent(
      [{ parentId: "parent", childId: "child_static", stamp: 10n }],
      10n,
      "/tf_static",
    );
    renderer.addMessageEvent(regularMsg);
    renderer.addMessageEvent(staticMsg);
    renderer.animationFrame();

    // Then: Both transforms should be present before seeking
    expect(renderer.transformTree.frame("child_regular")?.transformsSize()).toBe(1);
    expect(renderer.transformTree.frame("child_static")?.transformsSize()).toBe(1);

    // When: Seeking backward
    renderer.setCurrentTime(20n);
    renderer.handleSeek(100n);

    // Then: The regular transform should be cleared, but the static transform preserved
    const regularFrame = renderer.transformTree.frame("child_regular");
    expect(regularFrame == undefined || regularFrame.transformsSize() === 0).toBe(true);
    expect(renderer.transformTree.frame("child_static")?.transformsSize()).toBe(1);

    renderer.dispose();
  });

  it("caches and preserves static transforms received as geometry_msgs/TransformStamped messages", () => {
    // Given: A renderer that has received a regular and a static geometry_msgs/TransformStamped message
    const renderer = new Renderer({
      ...rendererArgs,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: false } },
      },
    });
    renderer.setCurrentTime(100n);
    const regularMsg = createTransformStampedEvent("parent", "child_regular", 50n, 50n, "/tf");
    const staticMsg = createTransformStampedEvent("parent", "child_static", 10n, 10n, "/tf_static");
    renderer.addMessageEvent(regularMsg);
    renderer.addMessageEvent(staticMsg);
    renderer.animationFrame();

    // Then: Both transforms should be present before seeking
    expect(renderer.transformTree.frame("child_regular")?.transformsSize()).toBe(1);
    expect(renderer.transformTree.frame("child_static")?.transformsSize()).toBe(1);

    // When: Seeking backward
    renderer.setCurrentTime(20n);
    renderer.handleSeek(100n);

    // Then: The regular transform should be cleared, but the static transform preserved
    const regularFrame = renderer.transformTree.frame("child_regular");
    expect(regularFrame == undefined || regularFrame.transformsSize() === 0).toBe(true);
    expect(renderer.transformTree.frame("child_static")?.transformsSize()).toBe(1);

    renderer.dispose();
  });

  it("does not cache a static transform that is rejected as a cyclic edge", () => {
    // Given: A renderer with a transform chain grandparent -> parent -> child
    const renderer = new Renderer({
      ...rendererArgs,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: false } },
      },
    });
    renderer.addMessageEvent(createTFMessageEvent("grandparent", "parent", 1n, [1n], "/tf"));
    renderer.addMessageEvent(createTFMessageEvent("parent", "child", 2n, [2n], "/tf"));
    renderer.animationFrame();

    // When: A cyclic *static* transform (child -> grandparent) is received
    renderer.addMessageEvent(createTFMessageEvent("child", "grandparent", 3n, [3n], "/tf_static"));
    renderer.animationFrame();

    // And: Seeking backward reapplies whatever was cached from static topics
    renderer.setCurrentTime(0n);
    renderer.handleSeek(100n);

    // Then: The cyclic transform must not have been cached, so it is not resurrected
    const grandparentFrame = renderer.transformTree.frame("grandparent");
    expect(grandparentFrame?.parent()?.id !== "child").toBe(true);

    renderer.dispose();
  });

  it("preserves static transforms when preloading is enabled and seeking backward", () => {
    // Given: A renderer with preloading enabled that has received a static transform, while the
    // tree is not complete yet (no history read), so a backward seek clears it
    const renderer = new Renderer({
      ...rendererArgs,
      config: {
        ...defaultRendererConfig,
        scene: { transforms: { enablePreloading: true } },
      },
    });
    renderer.setCurrentTime(100n);
    renderer.addMessageEvent(
      createTFMessageEvent("parent", "child_static", 10n, [10n], "/tf_static"),
    );
    renderer.animationFrame();
    expect(renderer.transformTree.frame("child_static")?.transformsSize()).toBe(1);

    // When: Seeking backward, which clears the tree
    renderer.setCurrentTime(20n);
    renderer.handleSeek(100n);

    // Then: The static transform is restored from the static cache
    expect(renderer.transformTree.frame("child_static")?.transformsSize()).toBe(1);

    renderer.dispose();
  });
});

describe("Renderer batch message processing", () => {
  let canvas = document.createElement("canvas");
  let parent = document.createElement("div");
  let rendererArgs: ConstructorParameters<typeof Renderer>[0] = {
    ...defaultRendererProps,
    canvas,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupVitestCanvasMock();
    parent = document.createElement("div");
    canvas = document.createElement("canvas");
    parent.appendChild(canvas);
    rendererArgs = { ...defaultRendererProps, canvas };
  });

  afterEach(() => {
    (console.warn as Mock).mockClear();
  });

  it("processes messages in batch grouped by topic and schema", () => {
    // Given: A renderer and messages with different topics
    const renderer = new Renderer(rendererArgs);
    const messages = [
      createTFMessageEvent("parent1", "child1", 1n, [1n], "/tf"),
      createTFMessageEvent("parent2", "child2", 2n, [2n], "/tf"),
      createTFMessageEvent("parent3", "child3", 3n, [3n], "/tf_static"),
    ];

    // When: Processing batch of messages
    renderer.setCurrentTime(10n);
    renderer.addMessageEventBatch(messages);
    renderer.animationFrame();

    // Then: All transforms should be added
    expect(renderer.transformTree.frame("child1")).toBeDefined();
    expect(renderer.transformTree.frame("child2")).toBeDefined();
    expect(renderer.transformTree.frame("child3")).toBeDefined();
  });

  it("handles empty batch gracefully", () => {
    // Given: A renderer
    const renderer = new Renderer(rendererArgs);

    // When: Processing empty batch
    renderer.addMessageEventBatch([]);

    // Then: Should not throw error
    expect(renderer.transformTree.frames().size).toBe(0);
  });

  it("groups messages by topic and convertTo when processing batch", () => {
    // Given: A renderer with multiple messages from same topic
    const renderer = new Renderer(rendererArgs);
    const messages = [
      createTFMessageEvent("parent1", "child1", 1n, [1n], "/tf"),
      createTFMessageEvent("parent2", "child2", 2n, [2n], "/tf"),
      createTFMessageEvent("parent3", "child3", 3n, [3n], "/tf"),
    ];

    // When: Processing batch
    renderer.setCurrentTime(10n);
    renderer.addMessageEventBatch(messages);
    renderer.animationFrame();

    // Then: All messages from same topic should be processed together
    expect(renderer.transformTree.frame("child1")).toBeDefined();
    expect(renderer.transformTree.frame("child2")).toBeDefined();
    expect(renderer.transformTree.frame("child3")).toBeDefined();
  });
});

describe("Renderer review fixes", () => {
  let canvas = document.createElement("canvas");
  beforeEach(() => {
    vi.clearAllMocks();
    setupVitestCanvasMock();
    const parent = document.createElement("div");
    canvas = document.createElement("canvas");
    parent.appendChild(canvas);
  });
  afterEach(() => {
    (console.warn as Mock).mockClear();
  });

  const noPreload = {
    ...defaultRendererConfig,
    scene: { transforms: { enablePreloading: false } },
  };

  it("keeps the transform tree when leaving image-only mode it was not in", () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    renderer.transformTree.setComplete(true);
    renderer.addTransformMessages([createTFMessageEvent("root", "a", 1n, [1n])]);

    renderer.disableImageOnlySubscriptionMode();

    expect(renderer.transformTree.frame("a")?.transformsSize()).toBe(1);
    expect(renderer.transformTree.isComplete()).toBe(true);
    renderer.dispose();
  });

  it("marks a cleared transform tree incomplete so its history is read again", () => {
    const renderer = new Renderer({
      ...defaultRendererProps,
      interfaceMode: "image" as const,
      canvas,
    });
    renderer.enableImageOnlySubscriptionMode();
    renderer.transformTree.setComplete(true);

    renderer.disableImageOnlySubscriptionMode();

    expect(renderer.transformTree.isComplete()).toBe(false);
    renderer.dispose();
  });

  it("deselects a renderable that clear() removed from the scene", () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    const detached = new THREE.Object3D();
    // @ts-expect-error - a plain object stands in for a disposed renderable
    renderer.setSelectedRenderable({ renderable: detached });
    const selected = vi.fn();
    renderer.on("selectedRenderable", selected);

    renderer.clear();

    expect(selected).toHaveBeenCalledWith(undefined, renderer);
    renderer.dispose();
  });

  it("keeps rendering after a frame throws", () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });
    // The frame handler's first step
    const step = vi.spyOn(renderer, "setCurrentTime").mockImplementationOnce(() => {
      throw new Error("boom");
    });

    expect(() => {
      renderer.animationFrame();
    }).toThrow("boom");
    renderer.animationFrame();

    expect(step).toHaveBeenCalledTimes(2);
    renderer.dispose();
  });

  it.each([
    { x: 0, y: 0, z: 0, w: 0 },
    { x: NaN, y: 0, z: 0, w: 1 },
    { x: 0, y: 0, z: 0, w: Infinity },
  ])("rejects the rotation %o with a settings error", (rotation) => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas });

    const result = renderer.addTransform("parent", "child", 1n, { x: 0, y: 0, z: 0 }, rotation);

    expect(result).toBe(AddTransformResult.INVALID);
    expect(renderer.transformTree.frame("child")?.transformsSize() ?? 0).toBe(0);
    expect(renderer.settings.errors.errors.errorAtPath(["transforms", "frame:child"])).toContain(
      "Invalid transform",
    );
    renderer.dispose();
  });

  it("reports an invalid first transform on the transforms node and clears it on valid data", () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas, config: noPreload });
    const errors = renderer.settings.errors.errors;
    renderer.setCurrentTime(100n);
    const event = createTFMessageEvent("root", "child", 10n, [10n], "/tf");
    event.message.transforms[0]!.transform.rotation.w = NaN;
    renderer.addMessageEvent(event);
    renderer.animationFrame();
    expect(errors.errorAtPath(["transforms"])).toContain('"child" on topic "/tf"');

    renderer.addMessageEvent(createTFMessageEvent("root", "child", 11n, [11n], "/tf"));
    renderer.animationFrame();
    expect(errors.errorAtPath(["transforms"])).toBeUndefined();
    expect(errors.errorAtPath(["transforms", "frame:child"])).toBeUndefined();
    renderer.dispose();
  });

  it("takes whether a topic is static from its setting, not its name", () => {
    const renderer = new Renderer({
      ...defaultRendererProps,
      canvas,
      config: {
        ...noPreload,
        scene: {
          transforms: {
            enablePreloading: false,
            staticTopics: { "/poses": true, "/tf_static": false },
          },
        },
      },
    });
    renderer.setCurrentTime(100n);
    renderer.addMessageEvent(createTFMessageEvent("root", "fromPoses", 10n, [10n], "/poses"));
    renderer.addMessageEvent(
      createTFMessageEvent("root", "fromTfStatic", 10n, [10n], "/tf_static"),
    );
    renderer.animationFrame();

    renderer.setCurrentTime(20n);
    renderer.handleSeek(100n);

    expect(renderer.transformTree.frame("fromPoses")?.transformsSize()).toBe(1);
    expect(renderer.transformTree.frame("fromTfStatic")?.transformsSize() ?? 0).toBe(0);
    renderer.dispose();
  });

  it("forgets a topic's static transforms when it is set to not static", () => {
    const renderer = new Renderer({ ...defaultRendererProps, canvas, config: noPreload });
    expect(renderer.isStaticTransformTopic("/tf_static")).toBe(true);
    renderer.setCurrentTime(100n);
    renderer.addMessageEvent(createTFMessageEvent("root", "a", 10n, [10n], "/tf_static"));
    renderer.animationFrame();
    expect(renderer.isStaticTransformFrame("a")).toBe(true);

    renderer.setStaticTransformTopic("/tf_static", { isStatic: false });

    expect(renderer.isStaticTransformTopic("/tf_static")).toBe(false);
    expect(renderer.isStaticTransformFrame("a")).toBe(false);
    renderer.dispose();
  });
});
