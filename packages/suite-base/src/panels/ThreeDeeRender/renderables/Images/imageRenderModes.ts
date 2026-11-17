// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Math for the 3D panel's image render modes (plane projection and depth map), shared by the
// renderer and the image decode worker.

import type { RawImage } from "@foxglove/schemas";

import type { ICameraModel } from "@lichtblick/suite";

import {
  DepthColorSettings,
  DepthDistanceType,
  MIN_PROJECTION_DISTANCE,
} from "./imageRenderModeSettings";
import type { Image as RosImage } from "../../ros";
import { getColorConverter } from "../colorMode";

/**
 * Without a max projection distance, rays flatter than this angle to the plane stop where a ray at
 * this angle would hit it, instead of reaching the horizon.
 */
const MIN_GRAZING_ANGLE_RAD = (2 * Math.PI) / 180;

/** Farthest a plane-projected pixel may land from the camera, in meters. */
export function planeProjectionMaxDistance(
  cameraHeightAbovePlane: number,
  projectionDistance: number | undefined,
): number {
  const distance =
    projectionDistance ?? Math.abs(cameraHeightAbovePlane) / Math.sin(MIN_GRAZING_ANGLE_RAD);
  return Math.max(distance, MIN_PROJECTION_DISTANCE);
}

/** Float depths are usually meters, integer depths millimeters. */
export function defaultDepthScale(encoding: string): number {
  return encoding === "32FC1" ? 1 : 0.001;
}

/**
 * Writes each pixel's depth in meters (`raw * scale`) to `out`, row-major. Invalid pixels (0, NaN)
 * stay invalid; the renderer drops anything that isn't a positive finite number.
 */
export function decodeDepthImage(
  image: Pick<RosImage | RawImage, "encoding" | "width" | "height" | "step" | "data"> & {
    is_bigendian?: boolean;
  },
  scale: number,
  out: Float32Array,
): void {
  const { encoding, width, height, step, data } = image;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const littleEndian = image.is_bigendian !== true;
  let bytesPerPixel: number;
  switch (encoding) {
    case "16UC1":
    case "mono16":
      bytesPerPixel = 2;
      break;
    case "32FC1":
      bytesPerPixel = 4;
      break;
    default:
      throw new Error(`Unsupported depth encoding ${encoding}, expected 16UC1 or 32FC1`);
  }
  if (
    step < width * bytesPerPixel ||
    data.byteLength < step * (height - 1) + width * bytesPerPixel
  ) {
    throw new Error(`Depth image data is too short for ${width}x${height} ${encoding}`);
  }
  for (let row = 0; row < height; row++) {
    const rowOffset = row * step;
    const outOffset = row * width;
    for (let col = 0; col < width; col++) {
      const raw =
        bytesPerPixel === 2
          ? view.getUint16(rowOffset + col * 2, littleEndian)
          : view.getFloat32(rowOffset + col * 4, littleEndian);
      out[outOffset + col] = raw * scale;
    }
  }
}

const isValidDepth = (depth: number) => depth > 0 && depth < Infinity;

/**
 * Colors each depth with the point cloud color modes, writing linear RGBA bytes. Without a value
 * range in `settings`, the range of the valid depths is used.
 */
export function colorizeDepth(
  depth: Float32Array,
  settings: DepthColorSettings,
  out: Uint8Array,
): void {
  let { minValue, maxValue } = settings;
  if (minValue == undefined || maxValue == undefined) {
    let min = Infinity;
    let max = -Infinity;
    for (const value of depth) {
      if (isValidDepth(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    minValue ??= min === Infinity ? 0 : min;
    maxValue ??= max === -Infinity ? 1 : max;
  }
  const converter = getColorConverter(settings, minValue, maxValue);
  const color = { r: 0, g: 0, b: 0, a: 0 };
  for (let i = 0; i < depth.length; i++) {
    converter(color, depth[i]!);
    out[i * 4 + 0] = color.r * 255;
    out[i * 4 + 1] = color.g * 255;
    out[i * 4 + 2] = color.b * 255;
    out[i * 4 + 3] = color.a * 255;
  }
}

/**
 * Fills `out` with one ray per depth pixel, scaled to z = 1, so `ray * depth` is the point for a
 * Z-axis depth and `normalize(ray) * depth` for a Euclidean one. Depth images may be scaled
 * relative to the calibration; pixel centers are mapped onto the calibrated image.
 */
export function computeDepthRays(
  cameraModel: Pick<ICameraModel, "width" | "height" | "projectPixelTo3dPlane">,
  width: number,
  height: number,
  out: Float32Array,
): void {
  const scaleX = cameraModel.width / width;
  const scaleY = cameraModel.height / height;
  const pixel = { x: 0, y: 0 };
  const ray = { x: 0, y: 0, z: 0 };
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      pixel.x = (col + 0.5) * scaleX - 0.5;
      pixel.y = (row + 0.5) * scaleY - 0.5;
      cameraModel.projectPixelTo3dPlane(ray, pixel);
      const i = (row * width + col) * 3;
      // Custom camera models may not return z = 1
      out[i + 0] = ray.x / ray.z;
      out[i + 1] = ray.y / ray.z;
      out[i + 2] = 1;
    }
  }
}

/** CPU twin of the depth cloud vertex shader; used by tests. */
export function unprojectDepth(
  ray: { x: number; y: number; z: number },
  depth: number,
  distanceType: DepthDistanceType,
): { x: number; y: number; z: number } | undefined {
  if (!isValidDepth(depth)) {
    return undefined;
  }
  const scale =
    distanceType === "euclidean" ? depth / Math.hypot(ray.x, ray.y, ray.z) : depth / ray.z;
  return { x: ray.x * scale, y: ray.y * scale, z: ray.z * scale };
}
