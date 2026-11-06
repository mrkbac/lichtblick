// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TileConfig } from "./types";

/**
 * Zoom and pan of a tile. The center is normalized to the displayed (rotated) image, so one view
 * shows the same region on tiles with different resolutions, which is what "Link zoom" relies on.
 */
export type View = {
  /** Multiplier on top of the tile's fit/fill scale, >= 1. */
  zoom: number;
  /** Displayed-image point (0..1) shown at the center of the tile. */
  centerX: number;
  centerY: number;
};

export const DEFAULT_VIEW: Readonly<View> = { zoom: 1, centerX: 0.5, centerY: 0.5 };

export const MAX_ZOOM = 50;

/** Image pixel -> canvas pixel transform, in the argument order of `ctx.setTransform`. */
export type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

/** What zooming and panning need to know about how a tile is currently drawn. */
export type Geometry = {
  canvasWidth: number;
  canvasHeight: number;
  /** Image size after rotation. */
  displayWidth: number;
  displayHeight: number;
  /** Canvas pixels per image pixel, including zoom. */
  scale: number;
};

type Orientation = Pick<TileConfig, "fit" | "rotation" | "flipHorizontal" | "flipVertical">;

const COS = [1, 0, -1, 0];
const SIN = [0, 1, 0, -1];

/**
 * Fills `out` and `geometry` (reused, so drawing allocates nothing) with the transform that draws
 * an `imageWidth` x `imageHeight` image into the canvas.
 */
export function computeTransform(
  out: Matrix,
  geometry: Geometry,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
  config: Orientation,
  view: Readonly<View>,
): void {
  const turn = config.rotation / 90;
  const quarterTurn = turn % 2 === 1;
  const displayWidth = quarterTurn ? imageHeight : imageWidth;
  const displayHeight = quarterTurn ? imageWidth : imageHeight;
  const fitScale = (config.fit === "fill" ? Math.max : Math.min)(
    canvasWidth / displayWidth,
    canvasHeight / displayHeight,
  );
  const scale = fitScale * view.zoom;
  const cos = COS[turn] ?? 1;
  const sin = SIN[turn] ?? 0;
  const flipX = config.flipHorizontal ? -1 : 1;
  const flipY = config.flipVertical ? -1 : 1;
  // Image center -> flip -> rotate -> scale -> put the view center at the canvas center.
  out.a = scale * cos * flipX;
  out.b = scale * sin * flipX;
  out.c = -scale * sin * flipY;
  out.d = scale * cos * flipY;
  const centerX = canvasWidth / 2 - (view.centerX - 0.5) * displayWidth * scale;
  const centerY = canvasHeight / 2 - (view.centerY - 0.5) * displayHeight * scale;
  out.e = centerX - (out.a * imageWidth + out.c * imageHeight) / 2;
  out.f = centerY - (out.b * imageWidth + out.d * imageHeight) / 2;

  geometry.canvasWidth = canvasWidth;
  geometry.canvasHeight = canvasHeight;
  geometry.displayWidth = displayWidth;
  geometry.displayHeight = displayHeight;
  geometry.scale = scale;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Zooms by `factor`, keeping the image point under canvas pixel (`x`, `y`) in place. Zooming back
 * to 1 recenters, so a fully zoomed-out tile always looks like it did before.
 */
export function zoomAt(
  view: Readonly<View>,
  factor: number,
  x: number,
  y: number,
  geometry: Readonly<Geometry>,
): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom * factor));
  if (zoom === 1) {
    return { ...DEFAULT_VIEW };
  }
  const { canvasWidth, canvasHeight, displayWidth, displayHeight, scale } = geometry;
  const newScale = (scale / view.zoom) * zoom;
  const offsetX = x - canvasWidth / 2;
  const offsetY = y - canvasHeight / 2;
  const pointX = view.centerX + offsetX / (scale * displayWidth);
  const pointY = view.centerY + offsetY / (scale * displayHeight);
  return {
    zoom,
    centerX: clamp01(pointX - offsetX / (newScale * displayWidth)),
    centerY: clamp01(pointY - offsetY / (newScale * displayHeight)),
  };
}

/** Moves the image by (`dx`, `dy`) canvas pixels; only a zoomed-in view can be panned. */
export function panBy(
  view: Readonly<View>,
  dx: number,
  dy: number,
  geometry: Readonly<Geometry>,
): Readonly<View> {
  if (view.zoom <= 1) {
    return view;
  }
  return {
    zoom: view.zoom,
    centerX: clamp01(view.centerX - dx / (geometry.scale * geometry.displayWidth)),
    centerY: clamp01(view.centerY - dy / (geometry.scale * geometry.displayHeight)),
  };
}

export function isDefaultView(view: Readonly<View>): boolean {
  return view.zoom === 1 && view.centerX === 0.5 && view.centerY === 0.5;
}
