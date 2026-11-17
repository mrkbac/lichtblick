// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Settings types and defaults for the 3D panel's image render modes. Kept free of three.js so the
// settings nodes and the decode worker can use them.

import type { ColorModeSettings } from "../../settingsNodes/colorMode";

export type ImageRenderMode = "default" | "plane" | "depth";
/** "z": depth is the distance along the camera's Z axis; "euclidean": along each pixel's ray. */
export type DepthDistanceType = "z" | "euclidean";

/** Projection distance is never below this, so a mistyped 0 doesn't collapse the image. */
export const MIN_PROJECTION_DISTANCE = 1;
export const DEFAULT_DEPTH_POINT_SIZE = 2;

export type DepthColorSettings = Pick<
  ColorModeSettings,
  "flatColor" | "gradient" | "colorMap" | "explicitAlpha" | "minValue" | "maxValue"
> & { colorMode: "flat" | "gradient" | "colormap" };

/** Matches the point cloud default gradient */
export const DEFAULT_DEPTH_GRADIENT: [string, string] = [
  "rgba(100, 47, 105, 1)",
  "rgba(227, 177, 135, 1)",
];

/** Depth points are colored like point clouds; the color map is the default. */
export function depthColorSettings(settings: Partial<ColorModeSettings>): DepthColorSettings {
  const { colorMode } = settings;
  return {
    colorMode:
      colorMode === "flat" || colorMode === "gradient" || colorMode === "colormap"
        ? colorMode
        : "colormap",
    flatColor: settings.flatColor ?? "#ffffff",
    gradient: settings.gradient ?? DEFAULT_DEPTH_GRADIENT,
    colorMap: settings.colorMap ?? "turbo",
    explicitAlpha: settings.explicitAlpha ?? 1,
    minValue: settings.minValue,
    maxValue: settings.maxValue,
  };
}

export type DepthDecodeOptions = {
  /** Meters per raw depth unit; defaults by encoding. */
  depthScale?: number;
  /** Colors the points from their depth; omitted when another image colors them. */
  color?: DepthColorSettings;
};

export type DecodedDepth = {
  width: number;
  height: number;
  /** Meters, row-major */
  depth: Float32Array;
  /** Linear RGBA bytes, row-major */
  colors?: Uint8Array;
};
