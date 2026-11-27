// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  MINIMUM_PIXEL_DISTANCE,
  downsampleTimeseriesColumns,
  downsampleScatter,
  downsamplePathColumns,
} from "./downsample";
import type { PlotViewport } from "./types";

type TestPoint = { x: number; y: number };
const timeseries = (points: TestPoint[], view: PlotViewport, maxPoints?: number) =>
  downsampleTimeseriesColumns(
    points.map((p) => p.x),
    points.map((p) => p.y),
    0,
    points.length,
    view,
    maxPoints,
  );
const scatter = (points: TestPoint[], view: PlotViewport) =>
  downsampleScatter(
    points.map((p) => p.x),
    points.map((p) => p.y),
    0,
    points.length,
    view,
  );

describe("downsampleTimeseriesColumns", () => {
  const bounds = {
    width: 100,
    height: 100,
    bounds: { x: { min: 0, max: 100 }, y: { min: 0, max: 100 } },
  };

  it("keeps an interval's spikes when it starts with a gap", () => {
    // All in one pixel interval: the gap, then a spike and a dip
    const ys = [Number.NaN, 1, 100, 1, -50, 1];
    const result = timeseries(
      ys.map((y, i) => ({ x: 20 + i * 0.01, y })),
      { ...bounds, bounds: { x: { min: 0, max: 100 }, y: { min: -50, max: 100 } } },
    );
    expect(result).toContain(0); // the gap
    expect(result).toContain(2); // the spike
    expect(result).toContain(4); // the dip
  });

  it("keeps spikes when an infinite value makes the y range infinite", () => {
    const ys = [0, 50, 0, -50, 0];
    const result = timeseries(
      ys.map((y, i) => ({ x: 20 + i * 0.01, y })),
      { ...bounds, bounds: { x: { min: 0, max: 100 }, y: { min: -50, max: Infinity } } },
    );
    expect(result).toEqual(expect.arrayContaining([1, 3]));
  });

  it("merges nearby points", () => {
    const result = timeseries(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 1 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
      ],
      bounds,
    );
    expect(result).toEqual([0, 1, 2, 5]);
  });

  it("should keep the min/max values within an interval", () => {
    const result = timeseries(
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 0, y: -20 },
        { x: 0, y: 4 },
      ],
      bounds,
    );
    expect(result).toEqual([0, 1, 2, 3]);
  });

  it("should keep entry/exit datum to an interval", () => {
    const result = timeseries(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 100 },
        { x: 1, y: 4 },
        { x: 2, y: 5 },
      ],
      {
        ...bounds,
        width: bounds.width * MINIMUM_PIXEL_DISTANCE,
      },
    );
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  it("should not produce out-of-order points", () => {
    const result = timeseries(
      [
        { x: 0, y: 15 },
        { x: 1, y: 100 },
        { x: 2, y: 10 },
        { x: 3, y: 15 },
      ],
      bounds,
      6, // two intervals
    );
    expect(result).toEqual([...result].sort((a, b) => a - b));
    expect(result).toEqual([0, 1, 2]);
  });
});

describe("downsampleScatter", () => {
  it("keeps one point per pixel for data far from the origin", () => {
    const view = {
      width: 100,
      height: 100,
      bounds: { x: { min: 11.5, max: 11.501 }, y: { min: 48.1, max: 48.101 } },
    };
    // Two points in the same pixel, one a pixel away
    const result = scatter(
      [
        { x: 11.5, y: 48.1 },
        { x: 11.500001, y: 48.100001 },
        { x: 11.50002, y: 48.1 },
      ],
      view,
    );
    expect(result).toEqual([0, 2]);
  });

  const bounds = {
    width: 100,
    height: 100,
    bounds: { x: { min: 0, max: 100 }, y: { min: 0, max: 100 } },
  };

  it.each([
    ["x", (i: number) => ({ x: -3, y: i })],
    ["y", (i: number) => ({ x: i, y: -3 })],
  ])("keeps every point when %s is constant", (axis, point) => {
    const points = [0, 1, 2].map(point);
    const constant = { min: -3, max: -3 };
    const varying = { min: 0, max: 2 };

    const result = scatter(points, {
      width: 100,
      height: 100,
      bounds: axis === "x" ? { x: constant, y: varying } : { x: varying, y: constant },
    });

    expect(result).toEqual([0, 1, 2]);
  });

  it("keeps points apart on an axis with inverted bounds", () => {
    // e.g. a fixed primary y min above a secondary series' automatic max
    const result = scatter(
      [
        { x: 0, y: 0 },
        { x: 0, y: 40 },
        { x: 100, y: 0 },
      ],
      { width: 100, height: 100, bounds: { x: { min: 0, max: 100 }, y: { min: 100, max: 40 } } },
    );

    expect(result).toEqual([0, 1, 2]);
  });

  it("ignores out of bounds points", () => {
    const result = scatter(
      [
        { x: -1, y: 0 },
        { x: 0, y: -1 },
        { x: 200, y: 0 },
        { x: 0, y: 200 },
      ],
      bounds,
    );
    expect(result).toEqual([1, 3]);
  });

  it("merges nearby points", () => {
    const result = scatter(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0.4 },
        { x: 0, y: 0.8 },
        { x: 0, y: 1 },
      ],
      bounds,
    );
    expect(result).toEqual([0, 2]);
  });
});

describe("downsamplePathColumns", () => {
  const view = {
    width: 100,
    height: 100,
    bounds: { x: { min: 0, max: 10 }, y: { min: 0, max: 10 } },
  };
  const run = (points: [number, number][]) =>
    downsamplePathColumns(
      Float64Array.from(points, (p) => p[0]),
      Float64Array.from(points, (p) => p[1]),
      0,
      points.length,
      view,
    );

  it("reduces a run beyond one edge to its ends", () => {
    // GIVEN a line that wanders left of the view and comes back
    expect(
      run([
        [5, 5],
        [-1, 5],
        [-2, 6],
        [-3, 4],
        [-1, 5],
        [5, 5],
      ]),
    ).toEqual([0, 1, 4, 5]);
  });

  it("keeps runs that cross from one edge to another, so the line cannot cut the view", () => {
    // GIVEN a line going around the view from the left to the right, above it
    const indices = run([
      [-1, 5],
      [-1, 11],
      [5, 11],
      [11, 11],
      [11, 5],
    ]);
    expect(indices).toEqual([0, 1, 3, 4]);
  });

  it("keeps the row where the line enters the view", () => {
    expect(
      run([
        [-0.01, 5],
        [0.01, 5],
        [-0.01, 6],
      ]),
    ).toEqual([0, 1, 2]);
  });

  it("stays within the point cap when the line crosses the view more often than it has pixels", () => {
    const n = 20_000;
    const xs = Float64Array.from({ length: n }, (_unused, i) => (i % 2 === 0 ? -1 : 11));
    const ys = Float64Array.from({ length: n }, () => 5);
    ys[100] = Number.NaN;
    const indices = downsamplePathColumns(xs, ys, 0, n, view, 1000);
    expect(indices.length).toBeLessThanOrEqual(1002);
    expect(indices).toContain(100);
    expect(indices.at(-1)).toBe(n - 1);
  });

  it("collapses consecutive gaps", () => {
    const gaps = new Float64Array(10_000).fill(Number.NaN);
    expect(downsamplePathColumns(gaps, gaps, 0, gaps.length, view, 100)).toEqual([0, 9999]);
  });

  it("drops rows within a pixel of the last kept one and keeps gaps", () => {
    const indices = run([
      [1, 1],
      [1.01, 1.01],
      [1.02, 1],
      [Number.NaN, Number.NaN],
      [5, 5],
      [5, 5.01],
    ]);
    expect(indices).toEqual([0, 2, 3, 4, 5]);
  });
});
