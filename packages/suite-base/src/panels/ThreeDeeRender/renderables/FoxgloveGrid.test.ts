/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Grid, NumericType } from "@foxglove/schemas";
import * as THREE from "three/webgpu";
import type { Mock } from "vitest";
import { setupVitestCanvasMock } from "vitest-canvas-mock";

import { MessageEvent, SettingsTreeAction } from "@lichtblick/suite";
import { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import { DEFAULT_CAMERA_STATE } from "@lichtblick/suite-base/panels/ThreeDeeRender/camera";
import { DEFAULT_PUBLISH_SETTINGS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/PublishSettings";

import { RendererConfig } from "../IRenderer";
import {
  FoxgloveGrid,
  LayerSettingsFoxgloveGrid,
  NO_ELEVATION,
  fillElevation,
} from "./FoxgloveGrid";
import { FOXGLOVE_GRID_DEFAULTS, foxgloveGridSettingsNode } from "../settingsNodes/topics";
import { getReader } from "./pointClouds/fieldReaders";

vi.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => ({ default: "" }));

vi.mock(
  "three/webgpu",
  async () => await (await import("../testing/fakeWebGPURenderer")).mockThreeWebGPU(),
);

const TOPIC = "/grid";

/** 3x2 grid of float32 cells, fields "value" (offset 0) and "height" (offset 4). */
function makeGrid(heights: number[]): Grid {
  const cols = 3;
  const cellStride = 8;
  const data = new Uint8Array(heights.length * cellStride);
  const view = new DataView(data.buffer);
  heights.forEach((height, i) => {
    view.setFloat32(i * cellStride, i, true);
    view.setFloat32(i * cellStride + 4, height, true);
  });
  return {
    timestamp: { sec: 0, nsec: 0 },
    frame_id: "map",
    pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    column_count: cols,
    cell_size: { x: 1, y: 1 },
    row_stride: cols * cellStride,
    cell_stride: cellStride,
    fields: [
      { name: "value", offset: 0, type: NumericType.FLOAT32 },
      { name: "height", offset: 4, type: NumericType.FLOAT32 },
    ],
    data,
  };
}

describe("fillElevation", () => {
  it("copies finite elevations and marks the rest as missing", () => {
    const grid = makeGrid([0, 1.5, NaN, -2, Infinity, 3]);
    const reader = getReader(grid.fields[1]!, grid.cell_stride)!;
    const out = new Float32Array(6);
    fillElevation(out, grid, reader);
    expect(Array.from(out)).toEqual([
      0,
      1.5,
      Math.fround(NO_ELEVATION),
      -2,
      Math.fround(NO_ELEVATION),
      3,
    ]);
  });
});

describe("foxgloveGridSettingsNode", () => {
  it("offers None plus every cell field as elevation, and documents every field", () => {
    const node = foxgloveGridSettingsNode({ name: TOPIC }, {}, ["value", "height"]);
    const elevationField = node.fields?.elevationField;
    expect(elevationField?.input === "select" && elevationField.options).toEqual([
      { label: "None", value: undefined },
      { label: "value", value: "value" },
      { label: "height", value: "height" },
    ]);
    for (const key of ["elevationField", "lighting", "interpolation", "showLines", "drawBehind"]) {
      expect(node.fields?.[key]?.help).toBeTruthy();
    }
  });

  it("disables lighting while flat and hides the line color while lines are off", () => {
    const flat = foxgloveGridSettingsNode({ name: TOPIC }, {}, ["height"]);
    expect(flat.fields?.lighting?.disabled).toBe(true);
    expect(flat.fields?.lineColor).toBeUndefined();
    expect(flat.fields?.interpolation?.value).toBe(FOXGLOVE_GRID_DEFAULTS.interpolation);

    const elevated = foxgloveGridSettingsNode(
      { name: TOPIC },
      { elevationField: "height", showLines: true },
      ["height"],
    );
    expect(elevated.fields?.lighting?.disabled).toBe(false);
    expect(elevated.fields?.lineColor?.value).toBe(FOXGLOVE_GRID_DEFAULTS.lineColor);
  });

  it("keeps a saved elevation field selectable before the first message", () => {
    const node = foxgloveGridSettingsNode({ name: TOPIC }, { elevationField: "height" }, undefined);
    const elevationField = node.fields?.elevationField;
    expect(elevationField?.input === "select" && elevationField.options).toContainEqual({
      label: "height",
      value: "height",
    });
  });
});

describe("FoxgloveGrid", () => {
  let renderer: Renderer;
  let extension: FoxgloveGrid;

  beforeEach(() => {
    setupVitestCanvasMock();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const config: RendererConfig = {
      cameraState: DEFAULT_CAMERA_STATE,
      followMode: "follow-pose",
      followTf: undefined,
      scene: {},
      transforms: {},
      topics: {
        [TOPIC]: {
          visible: true,
          colorField: "value",
          colorMode: "colormap",
        } as Partial<LayerSettingsFoxgloveGrid>,
      },
      layers: {},
      publish: DEFAULT_PUBLISH_SETTINGS,
      imageMode: {},
    };
    const canvas = document.createElement("canvas");
    document.createElement("div").appendChild(canvas);
    renderer = new Renderer({
      config,
      interfaceMode: "3d",
      fetchAsset: vi.fn(),
      testOptions: {},
      customCameraModels: new Map(),
      canvas,
    });
    extension = renderer.sceneExtensions.get(FoxgloveGrid.extensionId) as FoxgloveGrid;
  });

  afterEach(() => {
    renderer.dispose();
    // The config follows no frame, which the renderer warns about; errors stay visible
    (console.warn as Mock).mockClear();
  });

  function receive(grid: Grid): void {
    const event: MessageEvent<Grid> = {
      topic: TOPIC,
      schemaName: "foxglove.Grid",
      receiveTime: { sec: 0, nsec: 0 },
      message: grid,
      sizeInBytes: grid.data.byteLength,
    };
    const subscription = extension.getSubscriptions()[0]!;
    (subscription.subscription.handler as (event: MessageEvent<Grid>) => void)(event);
  }

  function update(key: string, value: unknown): void {
    extension.handleSettingsAction({
      action: "update",
      payload: { path: ["topics", TOPIC, key], input: "string", value },
    } as SettingsTreeAction);
  }

  it("switches between the flat quad and a GPU-displaced surface", () => {
    receive(makeGrid([0, 1, 2, 3, NaN, 5]));
    const renderable = extension.renderables.get(TOPIC)!;
    const { mesh, uniforms } = renderable.userData;
    expect(mesh.geometry).toBe(renderable.userData.planeGeometry);

    update("elevationField", "height");
    expect(mesh.geometry).toBe(renderable.userData.elevationGeometry);
    expect((mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(6);
    expect(mesh.frustumCulled).toBe(false);
    expect(uniforms.gridSize.value.toArray()).toEqual([3, 2]);
    const elevations = (uniforms.elevationMap.value as THREE.DataTexture).image
      .data as unknown as Float32Array;
    expect(elevations[4]).toBe(Math.fround(NO_ELEVATION));
    expect(elevations[5]).toBe(5);

    update("elevationField", undefined);
    expect(mesh.geometry).toBe(renderable.userData.planeGeometry);
  });

  it("hides a grid wider than the GPU's texture limit with an error until the limit allows it", () => {
    const wide = makeGrid([]);
    wide.column_count = 9000;
    wide.row_stride = 9000 * wide.cell_stride;
    wide.data = new Uint8Array(wide.row_stride);
    receive(wide);
    const renderable = extension.renderables.get(TOPIC)!;
    const errorAt = () => renderer.settings.errors.errors.errorAtPath(["topics", TOPIC]);
    // No device yet: WebGPU's guaranteed 8192
    expect(renderable.userData.mesh.visible).toBe(false);
    expect(errorAt()).toMatch(/9000 x 1 cells.*8192/);

    // The device asked for the adapter's larger limit
    (renderer.gl.backend as unknown as { device: unknown }).device = {
      limits: { maxTextureDimension2D: 16384 },
    };
    extension.gpuReady();
    expect(renderable.userData.mesh.visible).toBe(true);
    expect(errorAt()).toBeUndefined();
    expect(renderable.userData.texture.image.width).toBe(9000);
  });

  it("picks the shader's color source from the color mode and map", () => {
    receive(makeGrid([0, 1, 2, 3, 4, 5]));
    const { uniforms } = extension.renderables.get(TOPIC)!.userData;
    expect(uniforms.colorSource.value).toBe(2); // turbo
    update("colorMap", "rainbow");
    expect(uniforms.colorSource.value).toBe(3);
    update("colorMode", "gradient");
    expect(uniforms.colorSource.value).toBe(1);
    update("colorMode", "flat");
    expect(uniforms.colorSource.value).toBe(0); // texture
  });

  it("applies interpolation, lines and draw behind", () => {
    receive(makeGrid([0, 1, 2, 3, 4, 5]));
    const renderable = extension.renderables.get(TOPIC)!;
    const { mesh, material, uniforms } = renderable.userData;
    expect(renderable.userData.texture.magFilter).toBe(THREE.NearestFilter);
    expect(material.depthTest).toBe(true);

    update("interpolation", "linear");
    expect(renderable.userData.texture.magFilter).toBe(THREE.LinearFilter);

    update("lineColor", "#ff000080");
    // Lines off: transparent line color
    expect(uniforms.lineColor.value.w).toBe(0);
    update("showLines", true);
    expect(uniforms.lineColor.value.x).toBeCloseTo(1);
    expect(uniforms.lineColor.value.w).toBeCloseTo(128 / 255);

    update("drawBehind", true);
    expect(mesh.renderOrder).toBe(-Number.MAX_SAFE_INTEGER);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(false);

    update("drawBehind", false);
    expect(mesh.renderOrder).toBe(0);
    expect(material.depthTest).toBe(true);
  });
});
