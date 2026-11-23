// SPDX-License-Identifier: MPL-2.0

import { applyCameraFallback, type PointCloudCameraFrame, paintPointColors } from "./cameraColor";

const camera: PointCloudCameraFrame = {
  time: 0n,
  frameId: "camera",
  calibration: {
    header: { seq: 0, stamp: { sec: 0, nsec: 0 }, frame_id: "camera" },
    width: 4,
    height: 2,
    K: [2, 0, 0, 0, 2, 0, 0, 0, 1],
    P: [],
    R: [],
    D: [],
    distortion_model: "plumb_bob",
    binning_x: 0,
    binning_y: 0,
    roi: { x_offset: 0, y_offset: 0, height: 0, width: 0, do_rectify: false },
  },
  // The decoder can downsample the image. Pixel coordinates still refer to calibration size.
  pixels: {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 128, 255, 255]),
  },
};

const pose = {
  position: { x: 1, y: 0, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
};

describe("paintPointColors", () => {
  it("projects both in-view points and keeps original colors for out-of-view and rear points", () => {
    const points = Float32Array.of(-1, 0, 1, 0, 0, 1, 1, 0, 1, -1, 0, -1);
    const colors = new Uint8Array(16).fill(22);
    paintPointColors(points, colors, 4, camera, pose, "srgb");
    expect(Array.from(colors)).toEqual([
      255, 0, 0, 22, 0, 128, 255, 22, 22, 22, 22, 22, 22, 22, 22, 22,
    ]);
  });

  it("hides only unpainted points and restores their previous opacity", () => {
    const points = Float32Array.of(-1, 0, 1, 1, 0, 1);
    const original = Uint8Array.of(1, 2, 3, 128, 4, 5, 6, 200);
    const colors = original.slice();
    const painted = new Uint8Array(2);

    paintPointColors(points, colors, 2, camera, pose, "srgb", painted);
    applyCameraFallback(colors, original, painted, { hide: true });
    expect(Array.from(colors)).toEqual([255, 0, 0, 128, 4, 5, 6, 0]);

    applyCameraFallback(colors, original, painted, { hide: false });
    expect(Array.from(colors)).toEqual([255, 0, 0, 128, 4, 5, 6, 200]);
  });

  it("matches the transfer function of linear-colored point clouds", () => {
    const colors = Uint8Array.of(1, 2, 3, 255);
    paintPointColors(Float32Array.of(0, 0, 1), colors, 1, camera, pose, "linear");
    expect(Array.from(colors)).toEqual([0, 55, 255, 255]);
  });

  it("uses rectification and projection matrices for rectified images", () => {
    const calibration: PointCloudCameraFrame["calibration"] = {
      ...camera.calibration,
      D: [0.5, 0, 0, 0, 0],
      R: [0, -1, 0, 1, 0, 0, 0, 0, 1],
      P: [4, 0, 1, 0.5, 0, 4, 0, 0, 0, 0, 1, 0],
    };
    const points = Float32Array.of(-1, -0.25, 1);
    const colors = new Uint8Array(4);
    paintPointColors(points, colors, 1, { ...camera, calibration }, pose, "srgb");
    expect(Array.from(colors)).toEqual([0, 0, 0, 0]);
    paintPointColors(
      points,
      colors,
      1,
      { ...camera, calibration, projection: "rectified" },
      pose,
      "srgb",
    );
    expect(Array.from(colors)).toEqual([0, 128, 255, 0]);
  });
});
