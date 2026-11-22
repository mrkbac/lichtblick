// SPDX-License-Identifier: MPL-2.0

import { Quaternion, Vector3 } from "three";

import { PinholeCameraModel } from "@lichtblick/den/image";

import type { CameraInfo } from "../../ros";
import type { Pose } from "../../transforms";

export type PointCloudCameraFrame = {
  time: bigint;
  frameId: string;
  calibration: CameraInfo;
  pixels: Pick<ImageData, "width" | "height" | "data">;
};

export const CAMERA_COLOR_MAX_DELTA = 100_000_000n;

const projectors = new WeakMap<CameraInfo, PinholeCameraModel | undefined>();

function projector(calibration: CameraInfo): PinholeCameraModel | undefined {
  if (!projectors.has(calibration)) {
    const { K, P } = calibration;
    const intrinsics = K.length > 0 ? K : [P[0]!, 0, P[2]!, 0, P[5]!, P[6]!, 0, 0, 1];
    const [fx, , cx, , fy, cy] = intrinsics;
    let model: PinholeCameraModel | undefined;
    if (fx != undefined && fx > 0 && fy != undefined && fy > 0) {
      try {
        model = new PinholeCameraModel({
          ...calibration,
          K: intrinsics,
          // Projection is into the raw image using its optical frame.
          R: [],
          P: [fx, 0, cx!, 0, 0, fy, cy!, 0, 0, 0, 1, 0],
        });
      } catch {
        // Unsupported calibration keeps the layer's regular point colors.
      }
    }
    projectors.set(calibration, model);
  }
  return projectors.get(calibration);
}

const srgbToLinearByte = Uint8Array.from({ length: 256 }, (_, i) => {
  const s = i / 255;
  return Math.round(255 * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
});

const linearToSrgbByte = Uint8Array.from({ length: 256 }, (_, i) => {
  const x = i / 255;
  return Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055));
});

export function convertPointColorEncoding(colors: Uint8Array, target: "srgb" | "linear"): void {
  const table = target === "srgb" ? linearToSrgbByte : srgbToLinearByte;
  for (let i = 0; i < colors.length; i += 4) {
    colors[i] = table[colors[i]!]!;
    colors[i + 1] = table[colors[i + 1]!]!;
    colors[i + 2] = table[colors[i + 2]!]!;
  }
}

/** Overwrite only the RGB channels of points that project into the camera image. */
export function paintPointColors(
  positions: Float32Array,
  colors: Uint8Array,
  pointCount: number,
  camera: PointCloudCameraFrame,
  pointToCamera: Readonly<Pose>,
  encoding: "srgb" | "linear",
  paintedPoints?: Uint8Array,
): void {
  const model = projector(camera.calibration);
  if (!model) {
    return;
  }
  const { width, height, data } = camera.pixels;
  const { position: t, orientation: q } = pointToCamera;
  const { K } = model;
  const xScale = width / model.width;
  const yScale = height / model.height;
  const rotation = new Quaternion(q.x, q.y, q.z, q.w);
  const point = new Vector3();
  const ray = { x: 0, y: 0 };
  for (let i = 0; i < pointCount; ++i) {
    point.fromArray(positions, 3 * i).applyQuaternion(rotation);
    const depth = point.z + t.z;
    if (!(depth > 0)) {
      continue;
    }
    ray.x = (point.x + t.x) / depth;
    ray.y = (point.y + t.y) / depth;
    model.distortNormalized(ray, ray);
    const u = Math.floor((K[0] * ray.x + K[1] * ray.y + K[2]) * xScale);
    const v = Math.floor((K[4] * ray.y + K[5]) * yScale);
    if (!(u >= 0 && u < width && v >= 0 && v < height)) {
      continue;
    }
    const pixel = 4 * (v * width + u);
    if (data[pixel + 3] === 0) {
      continue;
    }
    if (paintedPoints) {
      paintedPoints[i] = 1;
    }
    for (let channel = 0; channel < 3; ++channel) {
      const value = data[pixel + channel]!;
      colors[4 * i + channel] = encoding === "linear" ? srgbToLinearByte[value]! : value;
    }
  }
}

/** Update visibility using the original opacity and the scan's camera coverage. */
export function applyCameraFallback(
  colors: Uint8Array,
  original: Uint8Array,
  painted: Uint8Array | undefined,
  { hide }: { hide: boolean },
): void {
  for (let i = 0, alpha = 3; alpha < original.length; i++, alpha += 4) {
    colors[alpha] = hide && painted?.[i] !== 1 ? 0 : original[alpha]!;
  }
}
