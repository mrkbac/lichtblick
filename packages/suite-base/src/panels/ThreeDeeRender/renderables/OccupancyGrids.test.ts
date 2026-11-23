/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";
import { setupVitestCanvasMock } from "vitest-canvas-mock";

import { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import { DEFAULT_CAMERA_STATE } from "@lichtblick/suite-base/panels/ThreeDeeRender/camera";
import { DEFAULT_PUBLISH_SETTINGS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/PublishSettings";

import { OccupancyGridRenderable, OccupancyGrids } from "./OccupancyGrids";
import { RendererConfig } from "../IRenderer";
import { SRGBToLinear } from "../color";
import { OccupancyGrid } from "../ros";

vi.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => ({ default: "" }));
vi.mock(
  "three/webgpu",
  async () => await (await import("../testing/fakeWebGPURenderer")).mockThreeWebGPU(),
);

const TOPIC = "/grid";

function makeConfig(settings: Record<string, unknown>): RendererConfig {
  return {
    cameraState: DEFAULT_CAMERA_STATE,
    followMode: "follow-pose",
    followTf: undefined,
    scene: {},
    transforms: {},
    topics: { [TOPIC]: { visible: true, ...settings } },
    layers: {},
    publish: DEFAULT_PUBLISH_SETTINGS,
    imageMode: {},
  };
}

function grid(values: number[], width = values.length): OccupancyGrid {
  return {
    header: { frame_id: "map", stamp: { sec: 0, nsec: 0 } },
    info: {
      map_load_time: { sec: 0, nsec: 0 },
      resolution: 1,
      width,
      height: 1,
      origin: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    },
    data: new Int8Array(values),
  };
}

describe("OccupancyGrids texture", () => {
  let renderer: Renderer;

  function setup(settings: Record<string, unknown>): {
    send: (values: number[], width?: number) => void;
    renderable: () => OccupancyGridRenderable;
  } {
    const parent = document.createElement("div");
    const canvas = document.createElement("canvas");
    parent.appendChild(canvas);
    renderer = new Renderer({
      canvas,
      config: makeConfig(settings),
      interfaceMode: "3d",
      fetchAsset: async () => {
        throw new Error("unused");
      },
      testOptions: {},
      customCameraModels: new Map(),
    });
    const extension = renderer.sceneExtensions.get(OccupancyGrids.extensionId) as OccupancyGrids;
    const subscription = extension.getSubscriptions()[0]!.subscription;
    return {
      send: (values, width) => {
        subscription.handler({
          topic: TOPIC,
          schemaName: "nav_msgs/OccupancyGrid",
          receiveTime: { sec: 0, nsec: 0 },
          message: grid(values, width),
          sizeInBytes: 0,
        } as never);
      },
      renderable: () => extension.renderables.get(TOPIC)!,
    };
  }

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
  });

  afterEach(() => {
    renderer.dispose();
    // jsdom has no WebGPU; the renderer warns about it
    (console.warn as Mock).mockClear();
  });

  function texels(renderable: OccupancyGridRenderable): number[][] {
    const data = Array.from(renderable.userData.texture.image.data as Uint8ClampedArray);
    return Array.from({ length: data.length / 4 }, (_, i) => data.slice(i * 4, i * 4 + 4));
  }

  it("colors custom mode cells between min and max, unknown and invalid", () => {
    const { send, renderable } = setup({
      colorMode: "custom",
      minColor: "rgba(255, 255, 255, 1)",
      maxColor: "rgba(0, 0, 0, 1)",
      unknownColor: "rgba(128, 128, 128, 1)",
      invalidColor: "rgba(255, 0, 255, 1)",
    });
    send([0, 50, 100, -1, 101, -128]);
    const gray = Math.trunc(SRGBToLinear(128 / 255) * 255);
    expect(texels(renderable())).toEqual([
      [255, 255, 255, 255],
      [128, 128, 128, 255], // 127.5 rounds like the texture's clamped bytes
      [0, 0, 0, 255],
      [gray, gray, gray, 255],
      [255, 0, 255, 255],
      [255, 0, 255, 255],
    ]);
  });

  it("colors palette modes with the layer alpha", () => {
    const { send, renderable } = setup({ colorMode: "map", alpha: 0.5 });
    send([0, 100, -1, 127]);
    expect(texels(renderable())).toEqual([
      [255, 255, 255, 128],
      [0, 0, 0, 128],
      [112, 137, 134, 128],
      [0, 255, 0, 128],
    ]);
  });

  it("skips the upload for a republished grid with the same cells", () => {
    const { send, renderable } = setup({ colorMode: "map" });
    send([0, 100, -1]);
    const texture = renderable().userData.texture;
    const version = texture.version;

    send([0, 100, -1]);
    expect(texture.version).toBe(version);

    send([0, 99, -1]);
    expect(texture.version).toBeGreaterThan(version);
    expect(texels(renderable())[1]).toEqual([2, 2, 2, 255]);
  });

  it("clears the invalid-grid error once a valid grid arrives", () => {
    const { send } = setup({ colorMode: "map" });
    const errorAt = () => renderer.settings.errors.errors.errorAtPath(["topics", TOPIC]);
    send([0, 100], 3);
    expect(errorAt()).toMatch(/data length/);
    send([0, 100]);
    expect(errorAt()).toBeUndefined();
  });
});
