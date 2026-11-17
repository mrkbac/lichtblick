// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { PinholeCameraModel } from "@lichtblick/den/image";

import { depthColorSettings } from "./imageRenderModeSettings";
import {
  colorizeDepth,
  computeDepthRays,
  decodeDepthImage,
  defaultDepthScale,
  planeProjectionMaxDistance,
  unprojectDepth,
} from "./imageRenderModes";

// fx = fy = 100, cx = 1.5, cy = 0.5: a 4x2 image whose principal point is its center
function pinhole(width = 4, height = 2): PinholeCameraModel {
  return new PinholeCameraModel({
    width,
    height,
    binning_x: 0,
    binning_y: 0,
    D: [],
    distortion_model: "",
    K: [100, 0, (width - 1) / 2, 0, 100, (height - 1) / 2, 0, 0, 1],
    P: [100, 0, (width - 1) / 2, 0, 0, 100, (height - 1) / 2, 0, 0, 0, 1, 0],
    R: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    roi: { x_offset: 0, y_offset: 0, height: 0, width: 0, do_rectify: false },
  });
}

describe("planeProjectionMaxDistance", () => {
  it("uses the configured distance, but at least 1 m", () => {
    expect(planeProjectionMaxDistance(2, 30)).toBe(30);
    expect(planeProjectionMaxDistance(2, 0.2)).toBe(1);
  });

  it("defaults to where a ray at 2 degrees below the horizon meets the plane", () => {
    const expected = 2 / Math.sin((2 * Math.PI) / 180);
    expect(planeProjectionMaxDistance(2, undefined)).toBeCloseTo(expected);
    // A camera below the plane looks up at it
    expect(planeProjectionMaxDistance(-2, undefined)).toBeCloseTo(expected);
    expect(planeProjectionMaxDistance(0, undefined)).toBe(1);
  });
});

describe("decodeDepthImage", () => {
  it("defaults the scale by encoding", () => {
    expect(defaultDepthScale("32FC1")).toBe(1);
    expect(defaultDepthScale("16UC1")).toBe(0.001);
  });

  it("reads little-endian 16UC1 rows with padding", () => {
    // 2x2, step 6 (2 bytes of padding per row)
    const data = new Uint8Array([0xe8, 0x03, 0x00, 0x00, 0xff, 0xff, 0xd0, 0x07, 0x01, 0x00, 0, 0]);
    const out = new Float32Array(4);
    decodeDepthImage({ encoding: "16UC1", width: 2, height: 2, step: 6, data }, 0.001, out);
    expect(Array.from(out)).toEqual([1, 0, 2, 0.0010000000474974513]);
  });

  it("reads big-endian 16UC1", () => {
    const data = new Uint8Array([0x03, 0xe8]);
    const out = new Float32Array(1);
    decodeDepthImage(
      { encoding: "16UC1", width: 1, height: 1, step: 2, data, is_bigendian: true },
      0.001,
      out,
    );
    expect(out[0]).toBe(1);
  });

  it("reads 32FC1 at an unaligned offset and keeps NaN", () => {
    const buffer = new Uint8Array(9);
    const view = new DataView(buffer.buffer, 1);
    view.setFloat32(0, 2.5, true);
    view.setFloat32(4, NaN, true);
    const out = new Float32Array(2);
    decodeDepthImage(
      { encoding: "32FC1", width: 2, height: 1, step: 8, data: buffer.subarray(1) },
      2,
      out,
    );
    expect(out[0]).toBe(5);
    expect(out[1]).toBeNaN();
  });

  it("rejects color images and short data", () => {
    const out = new Float32Array(4);
    expect(() => {
      decodeDepthImage(
        { encoding: "rgb8", width: 1, height: 1, step: 3, data: new Uint8Array(3) },
        1,
        out,
      );
    }).toThrow("Unsupported depth encoding rgb8");
    expect(() => {
      decodeDepthImage(
        { encoding: "16UC1", width: 2, height: 2, step: 4, data: new Uint8Array(6) },
        1,
        out,
      );
    }).toThrow("too short");
  });
});

describe("colorizeDepth", () => {
  it("spans the valid depths when no range is set", () => {
    const out = new Uint8Array(3 * 4);
    colorizeDepth(
      new Float32Array([0, 1, 3]),
      depthColorSettings({ colorMode: "gradient", gradient: ["#000000", "#ffffff"] }),
      out,
    );
    // The invalid 0 doesn't stretch the range: 1 m is the gradient's start, 3 m its end
    expect(Array.from(out.subarray(4, 8))).toEqual([0, 0, 0, 255]);
    expect(Array.from(out.subarray(8, 12))).toEqual([255, 255, 255, 255]);
  });

  it("fills a flat color with its alpha", () => {
    const out = new Uint8Array(4);
    colorizeDepth(
      new Float32Array([2]),
      depthColorSettings({ colorMode: "flat", flatColor: "rgba(255, 0, 0, 0.5)" }),
      out,
    );
    expect(Array.from(out)).toEqual([255, 0, 0, 127]);
  });

  it("defaults to the color map for color modes points can't use", () => {
    expect(depthColorSettings({ colorMode: "rgba" }).colorMode).toBe("colormap");
    expect(depthColorSettings({}).colorMode).toBe("colormap");
  });
});

describe("depth unprojection", () => {
  it("computes z = 1 rays through pixel centers", () => {
    const rays = new Float32Array(4 * 2 * 3);
    computeDepthRays(pinhole(), 4, 2, rays);
    // Pixel (0, 0) is 1.5 px left of and 0.5 px above the principal point
    expect(rays[0]).toBeCloseTo(-0.015);
    expect(rays[1]).toBeCloseTo(-0.005);
    expect(rays[2]).toBe(1);
    // Pixel (3, 1)
    expect(rays[21]).toBeCloseTo(0.015);
    expect(rays[22]).toBeCloseTo(0.005);
  });

  it("maps a smaller depth image onto the calibrated image", () => {
    const rays = new Float32Array(2 * 1 * 3);
    // The calibration is 4x2, the depth image 2x1: depth pixel 0 covers calibrated pixels 0-1
    computeDepthRays(pinhole(), 2, 1, rays);
    expect(rays[0]).toBeCloseTo(-0.01);
    expect(rays[1]).toBeCloseTo(0);
    expect(rays[3]).toBeCloseTo(0.01);
  });

  it("places Z-axis depths on the plane z = depth", () => {
    const point = unprojectDepth({ x: 0.3, y: -0.4, z: 1 }, 2, "z");
    expect(point).toEqual({ x: 0.6, y: -0.8, z: 2 });
  });

  it("places Euclidean depths at that distance from the camera", () => {
    const point = unprojectDepth({ x: 0.3, y: -0.4, z: 1 }, 2, "euclidean")!;
    expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(2);
    expect(point.x / point.z).toBeCloseTo(0.3);
  });

  it.each([0, -1, NaN, Infinity])("drops depth %s", (depth) => {
    expect(unprojectDepth({ x: 0, y: 0, z: 1 }, depth, "z")).toBeUndefined();
  });
});
