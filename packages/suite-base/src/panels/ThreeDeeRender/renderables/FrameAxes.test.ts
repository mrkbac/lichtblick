/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";
import type { Mock } from "vitest";
import { setupVitestCanvasMock } from "vitest-canvas-mock";

import { SettingsTreeAction } from "@lichtblick/suite";
import { Asset } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import { DEFAULT_SCENE_EXTENSION_CONFIG } from "@lichtblick/suite-base/panels/ThreeDeeRender/SceneExtensionConfig";
import { DEFAULT_CAMERA_STATE } from "@lichtblick/suite-base/panels/ThreeDeeRender/camera";
import { DEFAULT_PUBLISH_SETTINGS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/PublishSettings";

import { RendererConfig } from "../IRenderer";
import { Transform } from "../transforms";
import { FrameAxes } from "./FrameAxes";
import {
  rpyDegreesToQuat,
  TRANSFORM_OFFSETS_VARIABLE,
  TransformOffsets,
} from "../transforms/transformOffsets";

vi.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => ({ default: "" }));

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

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: undefined,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
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

describe("FrameAxes", () => {
  let canvas: HTMLCanvasElement;
  let parent: HTMLDivElement;
  let renderer: Renderer;

  beforeEach(() => {
    vi.clearAllMocks();
    setupVitestCanvasMock();
    parent = document.createElement("div");
    canvas = document.createElement("canvas");
    parent.appendChild(canvas);
    renderer = new Renderer({ ...defaultRendererProps, canvas });
  });

  afterEach(() => {
    renderer.dispose();
    (console.warn as Mock).mockClear();
  });

  describe("details()", () => {
    it("returns frame details with parent and fixed frame", () => {
      // Given: A frame with a parent
      const parentFrame = renderer.transformTree.getOrCreateFrame("parent");
      const childFrame = renderer.transformTree.getOrCreateFrame("child");
      childFrame.setParent(parentFrame);

      // Trigger transform tree update to create renderables
      renderer.emit("transformTreeUpdated", renderer);

      const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;
      const renderable = frameAxes.renderables.get("child");

      // When: Getting details
      const details = renderable?.details();

      // Then: Should contain frame information
      expect(details).toBeDefined();
      expect(details?.child_frame_id).toBe("child");
      expect(details?.parent_frame_id).toBe("parent");
      expect(details?.fixed_frame_id).toBe("parent");
    });
  });

  describe("dispose()", () => {
    it("releases label back to pool when disposed", () => {
      // Given: A frame axis with a label
      renderer.transformTree.getOrCreateFrame("test_frame");
      renderer.emit("transformTreeUpdated", renderer);

      const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;
      const renderable = frameAxes.renderables.get("test_frame");
      const label = renderable?.userData.label;

      const releaseSpy = vi.spyOn(renderer.labelPool, "release");

      // When: Disposing the renderable
      renderable?.dispose();

      // Then: Label should be released
      expect(releaseSpy).toHaveBeenCalledWith(label);
    });
  });

  describe("setColorScheme()", () => {
    it("sets labels to white foreground on dark background for dark theme", () => {
      // Given: FrameAxes extension with a frame
      renderer.transformTree.getOrCreateFrame("test_frame");
      renderer.emit("transformTreeUpdated", renderer);

      const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;
      const renderable = frameAxes.renderables.get("test_frame");
      const label = renderable?.userData.label;

      const setColorSpy = vi.spyOn(label!, "setColor");
      const setBackgroundSpy = vi.spyOn(label!, "setBackgroundColor");

      // When: Setting dark color scheme
      frameAxes.setColorScheme("dark", undefined);

      // Then: Should set white text (1, 1, 1) on black background (0, 0, 0)
      expect(setColorSpy).toHaveBeenCalledWith(1, 1, 1);
      expect(setBackgroundSpy).toHaveBeenCalledWith(0, 0, 0);
    });

    it("sets labels to black foreground on white background for light theme", () => {
      // Given: FrameAxes extension with a frame
      renderer.transformTree.getOrCreateFrame("test_frame");
      renderer.emit("transformTreeUpdated", renderer);

      const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;
      const renderable = frameAxes.renderables.get("test_frame");
      const label = renderable?.userData.label;

      const setColorSpy = vi.spyOn(label!, "setColor");
      const setBackgroundSpy = vi.spyOn(label!, "setBackgroundColor");

      // When: Setting light color scheme
      frameAxes.setColorScheme("light", undefined);

      // Then: Should set black text (0, 0, 0) on white background (1, 1, 1)
      expect(setColorSpy).toHaveBeenCalledWith(0, 0, 0);
      expect(setBackgroundSpy).toHaveBeenCalledWith(1, 1, 1);
    });

    it("adjusts foreground color based on custom background luminance", () => {
      // Given: FrameAxes extension with a frame
      renderer.transformTree.getOrCreateFrame("test_frame");
      renderer.emit("transformTreeUpdated", renderer);

      const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;
      const renderable = frameAxes.renderables.get("test_frame");
      const label = renderable?.userData.label;

      const setColorSpy = vi.spyOn(label!, "setColor");
      const darkBackground = new THREE.Color(0.1, 0.1, 0.1); // Dark background

      // When: Setting color scheme with dark custom background
      frameAxes.setColorScheme("dark", darkBackground);

      // Then: Should use white foreground for dark background
      expect(setColorSpy).toHaveBeenCalledWith(1, 1, 1);
    });
  });

  describe("handleSettingsAction()", () => {
    it("returns early for reorder-node without updating frame offsets", () => {
      // Given: FrameAxes with a frame that has editable settings enabled
      renderer.updateConfig((draft) => {
        draft.scene.transforms = { editable: true };
        draft.transforms["frame:test_frame"] = { xyzOffset: [1, 2, 3] };
      });
      renderer.transformTree.getOrCreateFrame("test_frame");
      renderer.emit("transformTreeUpdated", renderer);

      const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;
      const frame = renderer.transformTree.frame("test_frame");

      // Verify initial state has offset
      expect(frame?.offsetPosition).toEqual([1, 2, 3]);

      // When: Sending reorder-node action that would change xyzOffset if processed
      const reorderAction: SettingsTreeAction = {
        action: "reorder-node",
        payload: {
          path: ["transforms", "frame:test_frame", "xyzOffset"],
          targetPath: ["transforms", "frame:test_frame"],
        },
      };
      frameAxes.handleSettingsAction(reorderAction);

      // Then: Frame offset remains unchanged (early return prevented processing)
      expect(frame?.offsetPosition).toEqual([1, 2, 3]);
      expect(renderer.config.transforms["frame:test_frame"]?.xyzOffset).toEqual([1, 2, 3]);
    });

    it("does not call saveSetting or update axis scale for reorder-node action", () => {
      // Given: FrameAxes with a specific axis scale
      renderer.updateConfig((draft) => {
        draft.scene.transforms = { axisScale: 2.5 };
      });
      renderer.transformTree.getOrCreateFrame("test_frame");
      renderer.emit("transformTreeUpdated", renderer);

      const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;
      const renderable = frameAxes.renderables.get("test_frame");

      // Verify initial scale
      expect(renderable?.userData.axis.scale.x).toBe(2.5);

      // When: Sending reorder-node for settings path that would change axisScale
      const reorderAction: SettingsTreeAction = {
        action: "reorder-node",
        payload: {
          path: ["transforms", "settings", "axisScale"],
          targetPath: ["transforms", "settings"],
        },
      };
      frameAxes.handleSettingsAction(reorderAction);

      // Then: Axis scale remains unchanged (early return prevented saveSetting and setAxisScale)
      expect(renderable?.userData.axis.scale.x).toBe(2.5);
      expect(renderer.config.scene.transforms?.axisScale).toBe(2.5);
    });

    it("does not call updateConfig or toggle visibility for reorder-node action", () => {
      // Given: FrameAxes with mixed visibility states
      renderer.updateConfig((draft) => {
        draft.transforms["frame:frame1"] = { visible: true };
        draft.transforms["frame:frame2"] = { visible: false };
      });
      renderer.transformTree.getOrCreateFrame("frame1");
      renderer.transformTree.getOrCreateFrame("frame2");
      renderer.emit("transformTreeUpdated", renderer);

      const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;
      const renderable1 = frameAxes.renderables.get("frame1");
      const renderable2 = frameAxes.renderables.get("frame2");

      // Verify initial visibility states
      expect(renderable1?.userData.settings.visible).toBe(true);
      expect(renderable2?.userData.settings.visible).toBe(false);

      // When: Sending reorder-node that would normally flip a visibility value
      const reorderAction: SettingsTreeAction = {
        action: "reorder-node",
        payload: {
          path: ["transforms", "frame:frame2", "visible"],
          targetPath: ["transforms", "frame:frame2"],
        },
      };
      frameAxes.handleSettingsAction(reorderAction);

      // Then: Visibility states remain unchanged (early return prevented processing)
      expect(renderable1?.userData.settings.visible).toBe(true);
      expect(renderable2?.userData.settings.visible).toBe(false);
      expect(renderer.config.transforms["frame:frame2"]?.visible).toBe(false);
    });

    it("shows all frames when show-all action is triggered", () => {
      // Given: FrameAxes extension with multiple frames
      renderer.transformTree.getOrCreateFrame("frame1");
      renderer.transformTree.getOrCreateFrame("frame2");
      renderer.emit("transformTreeUpdated", renderer);

      const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;

      const action: SettingsTreeAction = {
        action: "perform-node-action",
        payload: {
          id: "show-all",
          path: ["transforms"],
        },
      };

      // When: Triggering show-all action
      frameAxes.handleSettingsAction(action);

      // Then: All renderables should be visible
      for (const renderable of frameAxes.renderables.values()) {
        expect(renderable.userData.settings.visible).toBe(true);
      }
    });

    it("hides all frames when hide-all action is triggered", () => {
      // Given: FrameAxes extension with multiple frames
      renderer.transformTree.getOrCreateFrame("frame1");
      renderer.transformTree.getOrCreateFrame("frame2");
      renderer.emit("transformTreeUpdated", renderer);

      const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;

      const action: SettingsTreeAction = {
        action: "perform-node-action",
        payload: {
          id: "hide-all",
          path: ["transforms"],
        },
      };

      // When: Triggering hide-all action
      frameAxes.handleSettingsAction(action);

      // Then: All renderables should be hidden
      for (const renderable of frameAxes.renderables.values()) {
        expect(renderable.userData.settings.visible).toBe(false);
      }
    });

    it("updates label size when labelSize setting is changed", () => {
      // Given: FrameAxes extension with a frame
      renderer.transformTree.getOrCreateFrame("test_frame");
      renderer.emit("transformTreeUpdated", renderer);

      const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;
      const renderable = frameAxes.renderables.get("test_frame");
      const label = renderable?.userData.label;

      const setLineHeightSpy = vi.spyOn(label!, "setLineHeight");

      const action: SettingsTreeAction = {
        action: "update",
        payload: {
          path: ["transforms", "settings", "labelSize"],
          value: 0.5,
          input: "number",
        },
      };

      // When: Changing label size
      frameAxes.handleSettingsAction(action);

      // Then: Label line height should be updated
      expect(setLineHeightSpy).toHaveBeenCalledWith(0.5);
    });

    it("updates axis scale when axisScale setting is changed", () => {
      // Given: FrameAxes extension with a frame
      renderer.transformTree.getOrCreateFrame("test_frame");
      renderer.emit("transformTreeUpdated", renderer);

      const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;
      const renderable = frameAxes.renderables.get("test_frame");
      const axis = renderable?.userData.axis;
      const scaleSpy = vi.spyOn(axis!.scale, "set");

      const action: SettingsTreeAction = {
        action: "update",
        payload: {
          path: ["transforms", "settings", "axisScale"],
          value: 2.0,
          input: "number",
        },
      };

      // When: Changing axis scale
      frameAxes.handleSettingsAction(action);

      // Then: Scale should be set to 2.0 for all axes
      expect(scaleSpy).toHaveBeenCalledWith(2.0, 2.0, 2.0);
    });

    it("updates frame visibility when visible setting is changed", () => {
      // Given: FrameAxes extension with a frame
      renderer.transformTree.getOrCreateFrame("test_frame");
      renderer.emit("transformTreeUpdated", renderer);

      const frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;

      const action: SettingsTreeAction = {
        action: "update",
        payload: {
          path: ["transforms", "frame:test_frame", "visible"],
          value: false,
          input: "boolean",
        },
      };

      // When: Changing frame visibility
      frameAxes.handleSettingsAction(action);

      // Then: Config should be updated
      expect(renderer.config.transforms["frame:test_frame"]?.visible).toBe(false);
    });
  });

  describe("manual calibration", () => {
    let frameAxes: FrameAxes;
    let published: TransformOffsets[];

    const update = (path: string[], value: unknown) => {
      frameAxes.handleSettingsAction({
        action: "update",
        payload: { path, value, input: "vec3" } as SettingsTreeAction["payload"] & {
          input: "vec3";
        },
      });
    };
    const lastPublished = () => published[published.length - 1]!;

    beforeEach(() => {
      document.body.appendChild(parent);
      // sensor is pitched 60 deg in the recording
      renderer.transformTree.addTransform(
        "sensor",
        "base",
        0n,
        new Transform([1, 0, 2], rpyDegreesToQuat([0, 60, 0])),
      );
      renderer.coordinateFrameList = renderer.transformTree.frameList();
      renderer.emit("transformTreeUpdated", renderer);
      // the mocked WebGLRenderer has no canvas; key handling looks up the panel through it
      Object.assign(renderer.gl, { domElement: canvas });
      renderer.updateConfig((draft) => {
        draft.scene.transforms = { editable: true, adjustStep: "fine" };
      });
      frameAxes = renderer.sceneExtensions.get("foxglove.FrameAxes") as FrameAxes;
      published = [];
      renderer.on("setVariable", (name, value) => {
        if (name === TRANSFORM_OFFSETS_VARIABLE) {
          published.push(value as TransformOffsets);
        }
      });
    });

    afterEach(() => {
      parent.remove();
    });

    it("sets the offset from a typed result: 60 deg recorded, 61 deg typed -> 1 deg offset", () => {
      update(["transforms", "frame:sensor", "resultRpy"], [0, 61, 0]);

      const offset = lastPublished().frames.sensor!;
      expect(offset.xyz).toEqual([0, 0, 0]);
      expect(offset.rpy[1]).toBeCloseTo(1, 6);
      expect(renderer.transformTree.frame("sensor")?.offsetEulerDegrees?.[1]).toBeCloseTo(1, 6);
    });

    it("applies offsets published by another panel and can show the original", () => {
      const fromOtherPanel = { frames: { sensor: { xyz: [0.1, 0, 0], rpy: [0, 0, 0] } } };
      renderer.setVariables(new Map([[TRANSFORM_OFFSETS_VARIABLE, fromOtherPanel]]));
      expect(renderer.transformTree.frame("sensor")?.offsetPosition).toEqual([0.1, 0, 0]);

      renderer.setVariables(
        new Map([[TRANSFORM_OFFSETS_VARIABLE, { ...fromOtherPanel, showOriginal: true }]]),
      );
      expect(renderer.transformTree.frame("sensor")?.offsetPosition).toBeUndefined();
    });

    it("re-applies shared offsets to frames re-created after a clear, even when not editable", () => {
      renderer.updateConfig((draft) => {
        draft.scene.transforms = { editable: false };
      });
      const shared = { frames: { sensor: { xyz: [0.1, 0, 0], rpy: [0, 0, 0] } } };
      renderer.setVariables(new Map([[TRANSFORM_OFFSETS_VARIABLE, shared]]));

      // backward seek: the tree is cleared, the frame comes back as a new object
      renderer.transformTree.clear();
      renderer.emit("transformTreeUpdated", renderer);
      expect(renderer.transformTree.frame("sensor")).toBeUndefined(); // not re-created early
      renderer.transformTree.addTransform("sensor", "base", 0n, Transform.Identity());
      renderer.emit("transformTreeUpdated", renderer);

      expect(renderer.transformTree.frame("sensor")?.offsetPosition).toEqual([0.1, 0, 0]);
    });

    it("applies another panel's write that arrives before its own echo", () => {
      update(["transforms", "frame:sensor", "xyzOffset"], [0.1, 0, 0]);
      const fromOtherPanel = { frames: { sensor: { xyz: [0.5, 0, 0], rpy: [0, 0, 0] } } };
      renderer.setVariables(new Map([[TRANSFORM_OFFSETS_VARIABLE, fromOtherPanel]]));
      expect(renderer.transformTree.frame("sensor")?.offsetPosition).toEqual([0.5, 0, 0]);
    });

    it("ignores stale echoes of its own edits", () => {
      update(["transforms", "frame:sensor", "xyzOffset"], [0.1, 0, 0]);
      const first = lastPublished();
      update(["transforms", "frame:sensor", "xyzOffset"], [0.2, 0, 0]);
      renderer.setVariables(new Map([[TRANSFORM_OFFSETS_VARIABLE, first]]));
      expect(renderer.transformTree.frame("sensor")?.offsetPosition).toEqual([0.2, 0, 0]);
    });

    it("nudges the keyboard frame with arrow keys and undoes with Ctrl+Z", () => {
      renderer.updateConfig((draft) => {
        draft.scene.transforms!.keyboardFrame = "sensor";
      });
      // jsdom has no pointer; treat the panel as hovered
      const matches = parent.matches.bind(parent);
      vi.spyOn(parent, "matches").mockImplementation((selector) =>
        selector === ":hover" ? true : matches(selector),
      );
      const press = (init: KeyboardEventInit) => {
        canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
      };

      press({ key: "ArrowUp" });
      expect(lastPublished().frames.sensor?.xyz).toEqual([0.001, 0, 0]);
      press({ key: "ArrowLeft", altKey: true, shiftKey: true });
      expect(lastPublished().frames.sensor?.rpy).toEqual([0, 0, 0.1]);

      // rotation keys step the result angles shown in the settings: pitch 60 -> 60.01
      press({ key: "ArrowUp", altKey: true });
      const node = frameAxes.settingsNodes()[0]!.node.children!["frame:sensor"]!;
      const resultRpy = node.fields?.resultRpy?.value as number[];
      expect(resultRpy[0]).toBeCloseTo(0, 6);
      expect(resultRpy[1]).toBeCloseTo(60.01, 6);
      expect(resultRpy[2]).toBeCloseTo(0.1, 6);

      // presses within the coalescing window form one undo step
      press({ key: "z", ctrlKey: true });
      expect(lastPublished().frames).toEqual({});
    });

    it("moves a legacy per-panel offset into the shared offsets on first edit", () => {
      renderer.updateConfig((draft) => {
        draft.transforms["frame:sensor"] = { xyzOffset: [0.5, 0, 0] };
      });
      renderer.emit("transformTreeUpdated", renderer);
      expect(renderer.transformTree.frame("sensor")?.offsetPosition).toEqual([0.5, 0, 0]);

      update(["transforms", "frame:sensor", "rpyCoefficient"], [0, 0, 2]);

      expect(lastPublished().frames.sensor).toEqual({ xyz: [0.5, 0, 0], rpy: [0, 0, 2] });
      expect(renderer.config.transforms["frame:sensor"]?.xyzOffset).toBeUndefined();
    });

    it("shows recorded, offset and result values in the settings", () => {
      update(["transforms", "frame:sensor", "rpyCoefficient"], [0, 1, 0]);
      const node = frameAxes.settingsNodes()[0]!.node.children!["frame:sensor"]!;
      expect(node.label?.trim()).toBe("sensor (adjusted)");
      expect(node.fields?.rpy?.value).toEqual([0, 60, 0]);
      const resultRpy = node.fields?.resultRpy?.value as number[];
      expect(resultRpy[1]).toBeCloseTo(61, 3);
    });

    it("shows one editable translation and rotation for a frame without an offset", () => {
      const node = frameAxes.settingsNodes()[0]!.node.children!["frame:sensor"]!;
      expect(Object.keys(node.fields ?? {})).toEqual([
        "parent",
        "age",
        "historySize",
        "resultXyz",
        "resultRpy",
      ]);
      expect(node.fields?.resultXyz?.label).toBe("Translation");
      expect(node.fields?.resultXyz?.readonly).toBe(false);
    });
  });
});
