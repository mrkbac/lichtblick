// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeTile } from "./types";
import {
  DEFAULT_VIEW,
  Geometry,
  MAX_ZOOM,
  Matrix,
  View,
  computeTransform,
  isDefaultView,
  panBy,
  zoomAt,
} from "./view";

function transform(
  canvas: [number, number],
  image: [number, number],
  tile: Partial<ReturnType<typeof makeTile>> = {},
  view: View = DEFAULT_VIEW,
) {
  const matrix: Matrix = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
  const geometry: Geometry = {
    canvasWidth: 0,
    canvasHeight: 0,
    displayWidth: 0,
    displayHeight: 0,
    scale: 0,
  };
  computeTransform(matrix, geometry, ...canvas, ...image, { ...makeTile("/a"), ...tile }, view);
  const apply = (x: number, y: number) => [
    matrix.a * x + matrix.c * y + matrix.e,
    matrix.b * x + matrix.d * y + matrix.f,
  ];
  return { matrix, geometry, apply };
}

describe("computeTransform", () => {
  it("letterboxes the image centered in fit mode", () => {
    // Given a 200x100 image in a 100x100 canvas
    const { apply, geometry } = transform([100, 100], [200, 100]);

    // Then it is scaled to the canvas width and centered vertically
    expect(geometry.scale).toBe(0.5);
    expect(apply(0, 0)).toEqual([0, 25]);
    expect(apply(200, 100)).toEqual([100, 75]);
  });

  it("covers the canvas in fill mode", () => {
    const { apply } = transform([100, 100], [200, 100], { fit: "fill" });
    expect(apply(0, 0)).toEqual([-50, 0]);
    expect(apply(200, 100)).toEqual([150, 100]);
  });

  it("rotates a quarter turn clockwise and swaps the display size", () => {
    // Given a 200x100 image rotated by 90° in a 100x200 canvas
    const { apply, geometry } = transform([100, 200], [200, 100], { rotation: 90 });

    // Then the image's top-left corner lands at the top-right
    expect(geometry.displayWidth).toBe(100);
    expect(geometry.displayHeight).toBe(200);
    expect(apply(0, 0)).toEqual([100, 0]);
    expect(apply(200, 100)).toEqual([0, 200]);
  });

  it("mirrors with flips", () => {
    const { apply } = transform([100, 100], [100, 100], {
      flipHorizontal: true,
      flipVertical: true,
    });
    expect(apply(0, 0)).toEqual([100, 100]);
  });

  it("shows the view center in the middle of the canvas, scaled by the zoom", () => {
    // Given a 2x zoom centered on the image's top-left quarter
    const { apply, geometry } = transform(
      [100, 100],
      [100, 100],
      {},
      {
        zoom: 2,
        centerX: 0.25,
        centerY: 0.25,
      },
    );

    // Then that point is in the middle
    expect(geometry.scale).toBe(2);
    expect(apply(25, 25)).toEqual([50, 50]);
  });

  it("keeps tiles of different resolutions aligned with the same normalized view", () => {
    const view = { zoom: 3, centerX: 0.7, centerY: 0.4 };
    const small = transform([100, 100], [64, 48], {}, view);
    const large = transform([100, 100], [1280, 960], {}, view);
    const [sx, sy] = small.apply(64 * 0.7, 48 * 0.4);
    const [lx, ly] = large.apply(1280 * 0.7, 960 * 0.4);
    expect(sx).toBeCloseTo(lx!);
    expect(sy).toBeCloseTo(ly!);
  });
});

describe("zoomAt", () => {
  const geometryAt = (view: View) => transform([100, 100], [100, 100], {}, view).geometry;

  it("keeps the image point under the cursor in place", () => {
    // Given an unzoomed tile
    const before = transform([100, 100], [100, 100]);

    // When zooming in 4x at canvas pixel (20, 30)
    const view = zoomAt(DEFAULT_VIEW, 4, 20, 30, before.geometry);

    // Then image pixel (20, 30) is still drawn at (20, 30)
    const after = transform([100, 100], [100, 100], {}, view);
    const [x, y] = after.apply(20, 30);
    expect(x).toBeCloseTo(20);
    expect(y).toBeCloseTo(30);
  });

  it("recenters when zoomed back out to 1 and clamps the zoom", () => {
    const zoomed = { zoom: 2, centerX: 0.3, centerY: 0.8 };
    expect(zoomAt(zoomed, 0.1, 10, 10, geometryAt(zoomed))).toEqual(DEFAULT_VIEW);
    expect(zoomAt(zoomed, 1000, 50, 50, geometryAt(zoomed)).zoom).toBe(MAX_ZOOM);
  });
});

describe("panBy", () => {
  it("moves the image with the pointer, in normalized units", () => {
    const view = { zoom: 2, centerX: 0.5, centerY: 0.5 };
    // 2x zoom on a 100px image in a 100px canvas: 200 canvas pixels per image width
    expect(panBy(view, 20, -40, transform([100, 100], [100, 100], {}, view).geometry)).toEqual({
      zoom: 2,
      centerX: 0.4,
      centerY: 0.7,
    });
  });

  it("does not pan an unzoomed view or past the image edge", () => {
    const { geometry } = transform([100, 100], [100, 100]);
    expect(panBy(DEFAULT_VIEW, 10, 10, geometry)).toBe(DEFAULT_VIEW);
    expect(panBy({ zoom: 2, centerX: 0.5, centerY: 0.5 }, -1000, 1000, geometry)).toMatchObject({
      centerX: 1,
      centerY: 0,
    });
  });

  it("detects the default view", () => {
    expect(isDefaultView(DEFAULT_VIEW)).toBe(true);
    expect(isDefaultView({ zoom: 1, centerX: 0.4, centerY: 0.5 })).toBe(false);
  });
});
