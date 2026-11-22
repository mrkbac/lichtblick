// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { DynamicBufferGeometry } from "@lichtblick/suite-base/panels/ThreeDeeRender/DynamicBufferGeometry";
import { LayerErrors } from "@lichtblick/suite-base/panels/ThreeDeeRender/LayerErrors";
import type { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import { MISSING_TRANSFORM } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/transforms";
import { PointCloud2, PointFieldType } from "@lichtblick/suite-base/panels/ThreeDeeRender/ros";
import { ColorModeSettings } from "@lichtblick/suite-base/panels/ThreeDeeRender/settingsNodes/colorMode";
import { DEFAULT_POINT_SETTINGS } from "@lichtblick/suite-base/panels/ThreeDeeRender/settingsNodes/topics";
import { updatePose } from "@lichtblick/suite-base/panels/ThreeDeeRender/updatePose";

import { createStixelMaterial, PointCloudHistoryRenderable } from "./PointClouds";
import { getColorConverter } from "./colorMode";
import { DecayPointRing } from "./pointClouds/DecayPointRing";
import { DECAY_LIMITED } from "./pointExtensionUtils";

vi.mock("@lichtblick/suite-base/panels/ThreeDeeRender/updatePose", () => ({
  updatePose: vi.fn(),
}));

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
const rendererMock = {
  settings: { errors: { add: noop, addToTopic: noop, remove: noop, removeFromTopic: noop } },
  normalizeFrameId: (frameId: string) => frameId,
};
const renderer = rendererMock as unknown as Renderer;

type Settings = typeof DEFAULT_POINT_SETTINGS & {
  stixelsEnabled: boolean;
  colorFieldComputed: undefined;
  decayMaxPoints?: number;
};

function decode(cloud: PointCloud2, overrides: Partial<Settings>, rendererOverride = renderer) {
  const settings: Settings = {
    ...DEFAULT_POINT_SETTINGS,
    visible: true,
    stixelsEnabled: false,
    colorFieldComputed: undefined,
    ...overrides,
  };
  const renderable = new PointCloudHistoryRenderable("/points", rendererOverride, {
    receiveTime: 0n,
    messageTime: 0n,
    frameId: "lidar",
    pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    settingsPath: ["topics", "/points"],
    settings,
    topic: "/points",
    latestPointCloud: cloud,
    latestOriginalMessage: undefined,
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
    renderable,
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

describe("PointCloudHistoryRenderable missing transform error", () => {
  it("clears only once both points and stixels resolve their transforms", () => {
    const errors = new LayerErrors();
    const path = ["topics", "/points"];
    const { renderable } = decode(makeCloud(), { stixelsEnabled: true }, {
      ...rendererMock,
      transformTree: {},
      settings: { errors },
    } as unknown as Renderer);

    // points fail, stixels resolve: the error must stay
    vi.mocked(updatePose).mockReturnValueOnce(false).mockReturnValue(true);
    renderable.startFrame(0n, "map", "map");
    expect(errors.hasError(path, MISSING_TRANSFORM)).toBe(true);
    expect(console.warn).toHaveBeenCalledTimes(1);
    vi.mocked(console.warn).mockClear();

    // both resolve: the error clears
    renderable.startFrame(0n, "map", "map");
    expect(errors.hasError(path, MISSING_TRANSFORM)).toBe(false);
  });
});

describe("PointCloudHistoryRenderable decay", () => {
  it("moves the previous scan into the decay ring and keeps the newest one pickable", () => {
    const { renderable, settings } = decode(makeCloud(), { colorMode: "flat", decayTime: 10 });
    const next = makeCloud();
    new DataView(next.data.buffer).setFloat32(0, 42, true);
    renderable.pushHistory(next, settings, 1n);
    renderable.updatePointCloud(next, undefined, settings, 1n);

    const ring = renderable.children.find((child) => child instanceof DecayPointRing)!;
    expect(ring).toBeInstanceOf(DecayPointRing);
    expect(ring.scanCount()).toBe(1);
    const ringPositions = ring.points().positionAttribute().array;
    expect(Array.from(ringPositions.slice(0, 12))).toEqual(POSITIONS.flat());

    const latest = renderable.children[0] as unknown as {
      pickableInstances: boolean;
      instanceDetails: (instanceId: number) => Record<string, unknown> | undefined;
    };
    expect(latest.pickableInstances).toBe(true);
    expect(latest.instanceDetails(0)).toMatchObject({ x: 42, y: 2, z: 3 });
  });

  it("puts an older scan (read back after a seek) straight into the ring, keeping the latest", () => {
    const { renderable, settings } = decode(makeCloud(), { colorMode: "flat", decayTime: 10 });
    renderable.updatePointCloud(makeCloud(), undefined, settings, 10n);
    const older = makeCloud();
    new DataView(older.data.buffer).setFloat32(0, 42, true);

    renderable.addOlderScan(older, settings, 5n);

    const ring = renderable.children.find((child) => child instanceof DecayPointRing)!;
    expect(ring.scanCount()).toBe(1);
    expect(ring.oldestReceiveTime()).toBe(5n);
    expect(ring.points().positionAttribute().array[0]).toBe(42);
    const latest = renderable.children[0] as unknown as {
      instanceDetails: (instanceId: number) => Record<string, unknown> | undefined;
    };
    expect(latest.instanceDetails(0)).toMatchObject({ x: POSITIONS[0]![0] });
  });

  it("adds an older scan's stixels to the stixel history too", () => {
    const { renderable, settings } = decode(makeCloud(), {
      colorMode: "flat",
      decayTime: 10,
      stixelsEnabled: true,
    });
    renderable.updatePointCloud(makeCloud(), undefined, settings, 10n);
    const before = renderable.children.length;

    renderable.addOlderScan(makeCloud(), settings, 5n);

    // The decay ring and one stixels renderable for the older scan
    expect(renderable.children.length).toBe(before + 2);
  });

  it("skips an older scan that can't be drawn without blanking the latest one", () => {
    const { renderable, settings } = decode(makeCloud(), { colorMode: "flat", decayTime: 10 });
    renderable.updatePointCloud(makeCloud(), undefined, settings, 10n);
    const broken = { ...makeCloud(), point_step: 7 }; // data isn't a multiple of it

    renderable.addOlderScan(broken, settings, 5n);

    expect(renderable.children.some((child) => child instanceof DecayPointRing)).toBe(false);
    const latest = renderable.children[0] as unknown as {
      geometry: { drawRange: { count: number } };
    };
    expect(latest.geometry.drawRange.count).toBe(POSITIONS.length);
  });

  it("drops the ring and its limit notice when the decay time is turned off", () => {
    const errors = new LayerErrors();
    const path = ["topics", "/points"];
    // 4-point clouds and a 10-point budget: the history thins at the third scan
    const { renderable, settings } = decode(makeCloud(), { decayTime: 10, decayMaxPoints: 1e-5 }, {
      ...rendererMock,
      transformTree: {
        apply: (out: unknown) => out,
        frames: () => new Map(),
        isComplete: () => false,
      },
      settings: { errors },
    } as unknown as Renderer);
    vi.mocked(updatePose).mockReturnValue(true);
    for (let i = 1; i <= 4; i++) {
      renderable.pushHistory(makeCloud(), settings, BigInt(i));
      renderable.updatePointCloud(makeCloud(), undefined, settings, BigInt(i));
    }
    renderable.startFrame(4n, "map", "map");
    expect(errors.hasError(path, DECAY_LIMITED)).toBe(true);
    vi.mocked(console.warn).mockClear(); // the limit notice is logged once

    renderable.updatePointCloud(makeCloud(), undefined, { ...settings, decayTime: 0 }, 5n);
    renderable.startFrame(5n, "map", "map");

    expect(renderable.children.some((child) => child instanceof DecayPointRing)).toBe(false);
    expect(errors.hasError(path, DECAY_LIMITED)).toBe(false);
  });

  it("shows the limit notice when no history fits next to the latest scan", () => {
    const errors = new LayerErrors();
    const path = ["topics", "/points"];
    // 6 points: one 4-point cloud fits, two don't
    const { renderable, settings } = decode(makeCloud(), { decayTime: 10, decayMaxPoints: 6e-6 }, {
      ...rendererMock,
      transformTree: {
        apply: (out: unknown) => out,
        frames: () => new Map(),
        isComplete: () => false,
      },
      settings: { errors },
    } as unknown as Renderer);
    vi.mocked(updatePose).mockReturnValue(true);
    renderable.pushHistory(makeCloud(), settings, 1n);
    renderable.updatePointCloud(makeCloud(), undefined, settings, 1n);

    renderable.startFrame(1n, "map", "map");

    expect(renderable.children.some((child) => child instanceof DecayPointRing)).toBe(true);
    expect(errors.hasError(path, DECAY_LIMITED)).toBe(true);
    vi.mocked(console.warn).mockClear(); // the limit notice is logged once
  });
});
