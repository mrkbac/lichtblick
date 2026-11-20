/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";
import type { Mock } from "vitest";
import { setupVitestCanvasMock } from "vitest-canvas-mock";

import { Asset } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import { DEFAULT_SCENE_EXTENSION_CONFIG } from "@lichtblick/suite-base/panels/ThreeDeeRender/SceneExtensionConfig";
import {
  DEFAULT_CAMERA_STATE,
  DEFAULT_ORBIT_CONTROLS_CONFIG,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/camera";
import { DEFAULT_PUBLISH_SETTINGS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/PublishSettings";

import { RendererConfig } from "../IRenderer";
import { CameraStateSettings } from "./CameraStateSettings";

let mockOrbitControls!: {
  screenSpacePanning: boolean;
  mouseButtons: { LEFT: number; RIGHT: number };
  touches: { ONE: number; TWO: number };
  keys: { LEFT: string; RIGHT: string; UP: string; BOTTOM: string };
  addEventListener: Mock;
  listenToKeyEvents: Mock;
  getDistance: Mock;
  getPolarAngle: Mock;
  getAzimuthalAngle: Mock;
  target: THREE.Vector3;
  update: Mock;
  dispose: Mock;
  minPolarAngle: number;
  maxPolarAngle: number;
  maxDistance: number;
};

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(function (query) {
      return {
        matches: false,
        media: query,
        onchange: undefined,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });
});

vi.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => ({ default: "" }));

vi.mock("three/examples/jsm/controls/OrbitControls", () => ({
  OrbitControls: vi.fn().mockImplementation(function () {
    return mockOrbitControls;
  }),
}));

vi.mock("three", async () => {
  const ActualTHREE = await vi.importActual("three");
  return {
    ...ActualTHREE,
    WebGLRenderer: function WebGLRenderer() {
      return {
        capabilities: {
          isWebGL2: true,
        },
        setPixelRatio: vi.fn(),
        setSize: vi.fn(),
        render: vi.fn(),
        clear: vi.fn(),
        setClearColor: vi.fn(),
        readRenderTargetPixels: vi.fn(),
        info: {
          reset: vi.fn(),
        },
        shadowMap: {},
        dispose: vi.fn(),
        clearDepth: vi.fn(),
        getDrawingBufferSize: () => ({ width: 100, height: 100 }),
      };
    },
  };
});

function setupOrbitControlsMock() {
  mockOrbitControls = {
    ...DEFAULT_ORBIT_CONTROLS_CONFIG,
    addEventListener: vi.fn(),
    listenToKeyEvents: vi.fn(),
    getDistance: vi.fn().mockReturnValue(DEFAULT_CAMERA_STATE.distance),
    getPolarAngle: vi.fn().mockReturnValue(THREE.MathUtils.degToRad(DEFAULT_CAMERA_STATE.phi)),
    getAzimuthalAngle: vi
      .fn()
      .mockReturnValue(THREE.MathUtils.degToRad(-DEFAULT_CAMERA_STATE.thetaOffset)),
    target: new THREE.Vector3(...DEFAULT_CAMERA_STATE.targetOffset),
    update: vi.fn(),
    dispose: vi.fn(),
    minPolarAngle: 0,
    maxPolarAngle: Math.PI,
    maxDistance: Infinity,
  };
}

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
  sceneExtensionConfig: DEFAULT_SCENE_EXTENSION_CONFIG,
  testOptions: {},
  customCameraModels: new Map(),
};

describe("CameraStateSettings", () => {
  let canvas: HTMLCanvasElement;
  let parent: HTMLDivElement;
  let renderer: Renderer;

  beforeEach(() => {
    vi.clearAllMocks();
    setupVitestCanvasMock();
    setupOrbitControlsMock();
    parent = document.createElement("div");
    canvas = document.createElement("canvas");
    parent.appendChild(canvas);
    renderer = new Renderer({ ...defaultRendererProps, canvas });
  });

  afterEach(() => {
    renderer.dispose();
    (console.warn as Mock).mockClear(); // Suppress warnings from the Renderer during tests, if any
  });

  describe("constructor", () => {
    it("creates an instance with correct default settings", () => {
      // Given
      const aspect = 16 / 9;

      // When
      const cameraStateSettings = new CameraStateSettings(renderer, canvas, aspect);
      cameraStateSettings.setCameraState(DEFAULT_CAMERA_STATE);

      // Then
      expect(cameraStateSettings).toBeInstanceOf(CameraStateSettings);
      expect(cameraStateSettings.getActiveCamera().type).toBe("PerspectiveCamera");
      expect(cameraStateSettings.getCameraState()).toMatchObject({
        ...DEFAULT_CAMERA_STATE,
        distance: expect.closeTo(DEFAULT_CAMERA_STATE.distance), // floating point comparisons
        phi: expect.closeTo(DEFAULT_CAMERA_STATE.phi),
        thetaOffset: expect.closeTo(DEFAULT_CAMERA_STATE.thetaOffset),
      });
      expect(cameraStateSettings.settingsNodes()).toHaveLength(2);
    });
  });

  it("bounds map zoom-out while keeping ordinary and orthographic cameras unbounded", () => {
    // Given
    Object.defineProperty(renderer, "sharedMap", {
      value: { maxCameraDistance: 1000 },
      configurable: true,
    });
    const handler = new CameraStateSettings(renderer, canvas, 1);
    // When / Then: map-backed perspective distance is bounded.
    handler.setCameraState({ ...DEFAULT_CAMERA_STATE, distance: 1e12 });
    expect(mockOrbitControls.maxDistance).toBe(1000);
    expect(handler.getActiveCamera().position.length()).toBeCloseTo(1000);
    // When / Then: orthographic distance remains unbounded.
    handler.setCameraState({ ...DEFAULT_CAMERA_STATE, perspective: false, distance: 1e12 });
    expect(mockOrbitControls.maxDistance).toBe(Infinity);
    // When / Then: ordinary 3D distance remains unbounded.
    Object.defineProperty(renderer, "sharedMap", { value: undefined });
    handler.setCameraState({ ...DEFAULT_CAMERA_STATE, distance: 1e12 });
    expect(mockOrbitControls.maxDistance).toBe(Infinity);
    expect(handler.getActiveCamera().position.length()).toBeCloseTo(1e12, 0);
    handler.dispose();
  });

  it("pushes the orbit target forward instead of stalling when zooming in past the near plane", () => {
    const handler = new CameraStateSettings(renderer, canvas, 1);
    const camera = handler.getActiveCamera();
    handler.setCameraState({ ...DEFAULT_CAMERA_STATE, distance: 2, near: 0.5 });
    mockOrbitControls.getDistance.mockImplementation(() =>
      mockOrbitControls.target.distanceTo(camera.position),
    );
    const listener = (type: string) =>
      mockOrbitControls.addEventListener.mock.calls.find(([t]) => t === type)![1] as () => void;
    const before = mockOrbitControls.target.clone();

    // When: a wheel zoom moves the camera to 0.2 from the target (below 2 * near)
    listener("start")();
    camera.position.lerp(mockOrbitControls.target, 0.9);
    listener("change")();

    // Then: the target moved away so the distance stays at the floor
    expect(mockOrbitControls.getDistance()).toBeCloseTo(1);
    expect(mockOrbitControls.target.distanceTo(before)).toBeCloseTo(0.8);
    handler.dispose();
  });

  it("draws camera moves at once but writes them to the config only when the camera rests", () => {
    vi.useFakeTimers();
    try {
      const handler = new CameraStateSettings(renderer, canvas, 1);
      const onConfigChange = vi.fn();
      renderer.on("configChange", onConfigChange);
      const queueFrame = vi.spyOn(renderer, "queueAnimationFrame");
      const change = mockOrbitControls.addEventListener.mock.calls.findLast(
        ([type]) => type === "change",
      )![1] as () => void;

      // When: the user drags the camera over several pointer moves
      for (const distance of [30, 31, 32]) {
        mockOrbitControls.getDistance.mockReturnValue(distance);
        change();
        vi.advanceTimersByTime(16);
      }

      // Then: every move draws a frame, but nothing reaches React yet
      expect(queueFrame).toHaveBeenCalled();
      expect(onConfigChange).not.toHaveBeenCalled();

      // When: the camera rests
      vi.advanceTimersByTime(150);

      // Then: the final camera state is written once
      expect(onConfigChange).toHaveBeenCalledTimes(1);
      expect(renderer.config.cameraState.distance).toBe(32);
      handler.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a pending camera write when a settings edit changes the camera", () => {
    vi.useFakeTimers();
    try {
      const handler = renderer.cameraHandler as CameraStateSettings;
      mockOrbitControls.getDistance.mockReturnValue(30);
      renderer.emit("cameraMove", renderer);

      handler.handleSettingsAction({
        action: "update",
        payload: { path: ["cameraState", "distance"], input: "number", value: 5 },
      });
      vi.advanceTimersByTime(500);

      expect(renderer.config.cameraState.distance).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("screen space panning", () => {
    const aspect = 16 / 9;

    it("defaults to screen space panning disabled", () => {
      // Given: A newly constructed CameraStateSettings instance
      new CameraStateSettings(renderer, canvas, aspect);

      // Then: Screen space panning should be disabled by default
      expect(mockOrbitControls.screenSpacePanning).toBe(false);
    });

    it("enables screen space panning when Alt key is held", () => {
      // Given: A CameraStateSettings instance with canvas keyboard listeners attached
      new CameraStateSettings(renderer, canvas, aspect);

      // When: A keydown event fires with the Alt key held
      canvas.dispatchEvent(new KeyboardEvent("keydown", { altKey: true, bubbles: true }));

      // Then: Screen space panning should be enabled
      expect(mockOrbitControls.screenSpacePanning).toBe(true);
    });

    it("disables screen space panning when Alt key is released", () => {
      // Given: A CameraStateSettings instance with Alt key already held
      new CameraStateSettings(renderer, canvas, aspect);
      canvas.dispatchEvent(new KeyboardEvent("keydown", { altKey: true, bubbles: true }));

      // When: A keyup event fires without the Alt key
      canvas.dispatchEvent(new KeyboardEvent("keyup", { altKey: false, bubbles: true }));

      // Then: Screen space panning should be disabled again
      expect(mockOrbitControls.screenSpacePanning).toBe(false);
    });

    it("does not enable screen space panning on keydown without Alt", () => {
      // Given: A CameraStateSettings instance with canvas keyboard listeners attached
      new CameraStateSettings(renderer, canvas, aspect);

      // When: A keydown event fires without the Alt key
      canvas.dispatchEvent(new KeyboardEvent("keydown", { altKey: false, bubbles: true }));

      // Then: Screen space panning should remain disabled
      expect(mockOrbitControls.screenSpacePanning).toBe(false);
    });
  });

  it.each(["distance", "fovy", "near", "far", "phi", "thetaOffset"] as const)(
    "uses the default %s when the field is cleared instead of saving undefined",
    (key) => {
      // Given
      const handler = new CameraStateSettings(renderer, canvas, 1);
      // When
      handler.handleSettingsAction({
        action: "update",
        payload: { path: ["cameraState", key], input: "number", value: undefined },
      });
      // Then
      expect(renderer.config.cameraState[key]).toBe(DEFAULT_CAMERA_STATE[key]);
      handler.dispose();
    },
  );

  it("fills cleared target offset components with the default", () => {
    // Given
    const handler = new CameraStateSettings(renderer, canvas, 1);
    // When
    handler.handleSettingsAction({
      action: "update",
      payload: { path: ["cameraState", "targetOffset"], input: "vec3", value: [1, undefined, 3] },
    });
    // Then
    expect(renderer.config.cameraState.targetOffset).toEqual([
      1,
      DEFAULT_CAMERA_STATE.targetOffset[1],
      3,
    ]);
    handler.dispose();
  });

  it("stores the log depth switch in the scene config", () => {
    // Given
    const handler = new CameraStateSettings(renderer, canvas, 1);
    // When
    handler.handleSettingsAction({
      action: "update",
      payload: { path: ["cameraState", "logDepth"], input: "boolean", value: true },
    });
    // Then
    expect(renderer.config.scene.logDepth).toBe(true);
    handler.dispose();
  });
});
