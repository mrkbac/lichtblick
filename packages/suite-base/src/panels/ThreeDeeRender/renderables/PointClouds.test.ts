// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { DynamicBufferGeometry } from "@lichtblick/suite-base/panels/ThreeDeeRender/DynamicBufferGeometry";
import { IRenderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/IRenderer";
import { PointCloud2, PointFieldType } from "@lichtblick/suite-base/panels/ThreeDeeRender/ros";

import { createStixelMaterial, PointCloudHistoryRenderable } from "./PointClouds";
import { ColorModeSettings, getColorConverter } from "./colorMode";
import {
  createInstancePickingMaterial,
  createPickingMaterial,
  DEFAULT_POINT_SETTINGS,
  pointCloudMaterial,
} from "./pointExtensionUtils";

const STRIDE = 16;
const POSITIONS = [
  [1, 2, 3],
  [-4.5, 0.25, 8],
  [100, -7, 0],
  [0.5, 0.5, -0.5],
];
const INTENSITIES = [0, 37.5, Number.NaN, 200];
const PACKED = [0xff112233, 0x80aabbcc, 0x00000000, 0x7f010203];

function makeCloud(): PointCloud2 {
  const data = new Uint8Array(POSITIONS.length * STRIDE);
  const view = new DataView(data.buffer);
  POSITIONS.forEach(([x, y, z], i) => {
    view.setFloat32(i * STRIDE, x!, true);
    view.setFloat32(i * STRIDE + 4, y!, true);
    view.setFloat32(i * STRIDE + 8, z!, true);
    view.setUint32(i * STRIDE + 12, PACKED[i]!, true);
  });
  return {
    header: { stamp: { sec: 0, nsec: 0 }, frame_id: "lidar", seq: 0 },
    height: 1,
    width: POSITIONS.length,
    is_bigendian: false,
    point_step: STRIDE,
    row_step: POSITIONS.length * STRIDE,
    is_dense: true,
    fields: [
      { name: "x", offset: 0, datatype: PointFieldType.FLOAT32, count: 1 },
      { name: "y", offset: 4, datatype: PointFieldType.FLOAT32, count: 1 },
      { name: "z", offset: 8, datatype: PointFieldType.FLOAT32, count: 1 },
      { name: "rgba", offset: 12, datatype: PointFieldType.UINT32, count: 1 },
    ],
    data,
  };
}

// Same layout, but the 4th field holds float32 intensities
function makeIntensityCloud(): PointCloud2 {
  const cloud = makeCloud();
  const view = new DataView(cloud.data.buffer);
  INTENSITIES.forEach((value, i) => {
    view.setFloat32(i * STRIDE + 12, value, true);
  });
  cloud.fields[3] = { name: "intensity", offset: 12, datatype: PointFieldType.FLOAT32, count: 1 };
  return cloud;
}

const noop = () => {};
const renderer = {
  settings: { errors: { add: noop, addToTopic: noop, remove: noop, removeFromTopic: noop } },
  normalizeFrameId: (frameId: string) => frameId,
} as unknown as IRenderer;

type Settings = typeof DEFAULT_POINT_SETTINGS & {
  stixelsEnabled: boolean;
  colorFieldComputed: undefined;
};

function decode(cloud: PointCloud2, overrides: Partial<Settings>) {
  const settings: Settings = {
    ...DEFAULT_POINT_SETTINGS,
    visible: true,
    stixelsEnabled: false,
    colorFieldComputed: undefined,
    ...overrides,
  };
  const renderable = new PointCloudHistoryRenderable("/points", renderer, {
    receiveTime: 0n,
    messageTime: 0n,
    frameId: "lidar",
    pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    settingsPath: ["topics", "/points"],
    settings,
    topic: "/points",
    latestPointCloud: cloud,
    latestOriginalMessage: undefined,
    material: pointCloudMaterial(settings),
    pickingMaterial: createPickingMaterial(settings),
    instancePickingMaterial: createInstancePickingMaterial(settings),
    stixelMaterial: createStixelMaterial(settings),
  });
  renderable.updatePointCloud(cloud, undefined, settings, 0n);
  const geometry = (renderable.children[0] as unknown as { geometry: DynamicBufferGeometry })
    .geometry;
  const stixels = (renderable.children[1] as unknown as { geometry: DynamicBufferGeometry })
    .geometry;
  return {
    stixelPositions: Array.from(stixels.attributes.position!.array),
    stixelColors: Array.from(stixels.attributes.color!.array),
    positions: Array.from(geometry.attributes.position!.array),
    colors: Array.from(geometry.attributes.color!.array),
    settings,
  };
}

/** Reference: run the converter per point like the original per-point loop */
function expectedColors(
  settings: ColorModeSettings & { colorMode: "flat" | "gradient" | "colormap" | "rgb" | "rgba" },
  values: number[],
  min: number,
  max: number,
): number[] {
  const converter = getColorConverter(settings, min, max);
  const out = { r: 0, g: 0, b: 0, a: 0 };
  return values.flatMap((value) => {
    converter(out, value);
    return [out.r, out.g, out.b, out.a].map((c) => new Uint8Array([Math.round(c * 255)])[0]!);
  });
}

function expectClose(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => {
    expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(1);
  });
}

describe("PointCloudHistoryRenderable buffers", () => {
  it("decodes float32 positions", () => {
    const { positions } = decode(makeCloud(), { colorMode: "flat" });
    expect(positions).toEqual(POSITIONS.flat());
  });

  it.each(["rgb", "rgba"] as const)("unpacks %s colors exactly", (colorMode) => {
    const { colors, settings } = decode(makeCloud(), { colorMode, colorField: "rgba" });
    expect(colors).toEqual(expectedColors({ ...settings, colorMode }, PACKED, 0, 0));
  });

  it("fills flat colors", () => {
    const { colors, settings } = decode(makeCloud(), {
      colorMode: "flat",
      flatColor: "#ff8000",
    });
    expect(colors).toEqual(expectedColors({ ...settings, colorMode: "flat" }, [0, 0, 0, 0], 0, 0));
  });

  it.each([
    ["gradient", {}],
    ["colormap", { colorMap: "turbo" }],
    ["colormap", { colorMap: "rainbow" }],
  ] as const)("matches the %s converter %o, ignoring NaN for auto range", (colorMode, extra) => {
    const { colors, settings } = decode(makeIntensityCloud(), {
      colorMode,
      colorField: "intensity",
      ...extra,
    });
    // auto range skips the NaN point: [0, 200]
    expectClose(colors, expectedColors({ ...settings, colorMode }, INTENSITIES, 0, 200));
  });

  it("duplicates positions and colors into stixels", () => {
    const { colors, stixelPositions, stixelColors } = decode(makeCloud(), {
      colorMode: "rgba",
      colorField: "rgba",
      stixelsEnabled: true,
    });
    expect(stixelPositions).toEqual(POSITIONS.flatMap(([x, y, z]) => [x, y, z, x, y, 0]));
    expect(stixelColors).toEqual(
      POSITIONS.flatMap((_, i) => [
        ...colors.slice(i * 4, i * 4 + 4),
        ...colors.slice(i * 4, i * 4 + 4),
      ]),
    );
  });

  it("clamps to an explicit range", () => {
    const { colors, settings } = decode(makeIntensityCloud(), {
      colorMode: "gradient",
      colorField: "intensity",
      minValue: 10,
      maxValue: 50,
    });
    expectClose(
      colors,
      expectedColors({ ...settings, colorMode: "gradient" }, INTENSITIES, 10, 50),
    );
  });
});
