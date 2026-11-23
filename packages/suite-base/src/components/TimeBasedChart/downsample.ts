// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { PlotViewport } from "./types";

// This is the desired number of data points for each plot across all signals
// and data sources. Beyond this threshold, ChartJS can no longer render at
// 60FPS.
export const MAX_POINTS = 5_000;

// Each interval can produce up to this many points
const POINTS_PER_INTERVAL = 4;

// Points that appear within this threshold are visually indistinguishable
export const MINIMUM_PIXEL_DISTANCE = 3;

/**
 * Calculate the size of the intervals the downsampling operation should use,
 * expressed as a ratio of pixels to units in the coordinate frame of the plot.
 */
export function calculateIntervals(
  view: PlotViewport,
  pointsPerInterval: number,
  maxPoints?: number,
): {
  pixelPerXValue: number;
  pixelPerYValue: number;
} {
  const { bounds, width, height } = view;
  const numPixelIntervals = Math.trunc(width / MINIMUM_PIXEL_DISTANCE);
  // When maxPoints is provided, we should take either that constant or
  // the number of pixel-defined intervals, whichever is fewer
  const numPoints = Math.min(
    maxPoints ?? numPixelIntervals * pointsPerInterval,
    numPixelIntervals * pointsPerInterval,
  );
  // We then calculate the number of intervals based on the number of points we
  // decided on
  const numIntervals = Math.trunc(numPoints / pointsPerInterval);
  return {
    pixelPerXValue: numIntervals / (bounds.x.max - bounds.x.min),
    pixelPerYValue: height / (bounds.y.max - bounds.y.min),
  };
}

/**
 * Downsample a timeseries over columnar x/y arrays, rows [start, end), by returning the absolute
 * row indices of a subset of points that are deemed to be representative of the original data when
 * rendered with the given viewport.
 *
 * This function assumes that x-values are monotonically increasing.
 *
 * If `maxPoints` is provided, this returns only up to `maxPoints` points.
 *
 * The downsampled data preserves the shape of the original data. The algorithm does this by
 * downsampling within an interval. Each interval tracks the first datum of the interval,
 * minimum y-value datum, maximum y-value datum, and the last datum of the interval.
 *
 * For each datum within the dataset, we determine first if it falls within the current interval.
 * - If the datum falls within the current interval we update the min/max y or last values. Then move
 *   to the next datum.
 * - If the datum falls outside the current interval, we determine whether to add the min/max and
 *   last datum to the downsampled dataset, and then move to the next datum.
 * - If first/min/max/last are all the same datum, then only one datum appears in the downsampled
 *   dataset.
 *
 * By tracking the first/min/max/last within an interval, the shape of the original data is preserved.
 * Points before the interval connect into the interval with the same slope line as the original
 * dataset, and the interval connects to the next interval with the same slope line as the original
 * data. The min/max entries preserve spikes within the data.
 */
export function downsampleTimeseriesColumns(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  start: number,
  end: number,
  view: PlotViewport,
  maxPoints?: number,
): number[] {
  const { pixelPerXValue, pixelPerYValue } = calculateIntervals(
    view,
    POINTS_PER_INTERVAL,
    maxPoints,
  );
  const indices: number[] = [];
  let intX = Number.NaN;
  let firstY = 0;
  let lastY = 0;
  let lastI = -1;
  let minY = 0;
  let minI = -1;
  let maxY = 0;
  let maxI = -1;

  // add min/max/last of the finished interval when they differ from its first (and last) value
  const finishInterval = () => {
    if (lastI < 0) {
      return;
    }
    const addMin = minY !== firstY && minY !== lastY;
    const addMax = maxY !== firstY && maxY !== lastY;
    if (addMin && addMax && maxI < minI) {
      indices.push(maxI, minI);
    } else {
      if (addMin) {
        indices.push(minI);
      }
      if (addMax) {
        indices.push(maxI);
      }
    }
    if (firstY !== lastY) {
      indices.push(lastI);
    }
  };

  for (let i = start; i < end; i++) {
    const x = Math.trunc(xs[i]! * pixelPerXValue);
    const y = Math.trunc(ys[i]! * pixelPerYValue);
    if (lastI < 0 || x !== intX) {
      finishInterval();
      // always add the first datum of a new interval
      indices.push(i);
      intX = x;
      firstY = lastY = minY = maxY = y;
      lastI = minI = maxI = i;
      continue;
    }
    lastY = y;
    lastI = i;
    if (y < minY) {
      minY = y;
      minI = i;
    }
    if (y > maxY) {
      maxY = y;
      maxI = i;
    }
  }
  finishInterval();
  return indices;
}

/** Downsample scatter points in columnar x/y rows [start, end) to one per pixel. */
export function downsampleScatter(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  start: number,
  end: number,
  view: PlotViewport,
): number[] {
  const { bounds, width, height } = view;

  // A constant axis has zero-width bounds; its values then all share one pixel on that axis
  // (Inverted bounds still scale and keep points apart.)
  const pixelsPerValue = (pixels: number, range: number) => (range !== 0 ? pixels / range : 0);
  const pixelPerXValue = pixelsPerValue(width, bounds.x.max - bounds.x.min);
  const pixelPerYValue = pixelsPerValue(height, bounds.y.max - bounds.y.min);
  const pixelPerRow = width;

  const indices: number[] = [];

  // downsampling tracks a sparse array of x/y locations
  const sparse: boolean[] = [];

  for (let i = start; i < end; i++) {
    const dx = xs[i]!;
    // Out-of-bounds scatter points are ignored. We don't filter on y
    // because y values are needed to allow chart to auto scale to the correct
    // height.
    if (dx > bounds.x.max || dx < bounds.x.min) {
      continue;
    }

    const x = Math.round(dx * pixelPerXValue);
    const y = Math.round(ys[i]! * pixelPerYValue);

    // the locator is the x/y pixel value as one number
    const locator = y * pixelPerRow + x;
    if (sparse[locator] === true) {
      continue;
    }
    sparse[locator] = true;
    indices.push(i);
  }

  return indices;
}

/**
 * Downsample a line through columnar x/y rows [start, end) in drawing order, where x need not be
 * sorted (e.g. an x/y trajectory). Returns absolute row indices of at most about `maxPoints` rows:
 * - inside the view, a row is dropped while it stays within `distance` pixels of the last kept
 *   row; the distance grows until the result fits `maxPoints`
 * - outside the view, a run of rows beyond the same edge is reduced to its first and last row
 *   (the line between them stays beyond that edge, so it cannot cross the view)
 * - gaps (NaN) and the last row are always kept
 */
export function downsamplePathColumns(
  xs: Float64Array,
  ys: Float64Array,
  start: number,
  end: number,
  view: PlotViewport,
  maxPoints = MAX_POINTS,
): number[] {
  const { bounds, width, height } = view;
  const pixelsPerValue = (pixels: number, range: number) => (range !== 0 ? pixels / range : 0);
  const pixelPerX = pixelsPerValue(width, bounds.x.max - bounds.x.min);
  const pixelPerY = pixelsPerValue(height, bounds.y.max - bounds.y.min);
  const xMin = Math.min(bounds.x.min, bounds.x.max);
  const xMax = Math.max(bounds.x.min, bounds.x.max);
  const yMin = Math.min(bounds.y.min, bounds.y.max);
  const yMax = Math.max(bounds.y.min, bounds.y.max);
  // Which edges each row is beyond: 1 left, 2 right, 4 below, 8 above; NaN rows are gaps (-1).
  // Computed once and shared by the passes below.
  const codes = new Int8Array(Math.max(0, end - start));
  for (let i = start; i < end; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    codes[i - start] =
      Number.isNaN(x) || Number.isNaN(y)
        ? -1
        : (x < xMin ? 1 : 0) | (x > xMax ? 2 : 0) | (y < yMin ? 4 : 0) | (y > yMax ? 8 : 0);
  }

  for (let distance = 1; ; ) {
    const indices: number[] = [];
    let lastPx = Number.NaN;
    let lastPy = Number.NaN;
    // edges shared by every row since the last kept one
    let mask = 0;
    let prevCode = -1;
    for (let i = start; i < end; i++) {
      const code = codes[i - start]!;
      const nextCode = i + 1 < end ? codes[i + 1 - start]! : -1;
      if (code === -1 && prevCode === -1 && i > start && i < end - 1) {
        continue; // One marker breaks the line across a run of missing values.
      }
      let keep = code === -1 || i === start || i === end - 1 || nextCode === -1;
      if (!keep && code !== 0) {
        const shared = mask & code & nextCode;
        keep = shared === 0;
        mask = keep ? code : shared;
      } else if (!keep) {
        // rows where the line enters or leaves the view stay, so it is drawn up to the edge
        keep = prevCode !== 0 || nextCode !== 0;
        if (!keep) {
          const px = xs[i]! * pixelPerX;
          const py = ys[i]! * pixelPerY;
          keep = !(Math.abs(px - lastPx) < distance && Math.abs(py - lastPy) < distance);
        }
      }
      if (keep) {
        indices.push(i);
        mask = code === -1 ? 0 : code;
        lastPx = xs[i]! * pixelPerX;
        lastPy = ys[i]! * pixelPerY;
      }
      prevCode = code;
    }
    if (indices.length <= maxPoints) {
      return indices;
    }
    if (distance > Math.max(width, height)) {
      // ponytail: a line crossing the view more often than it has pixels (e.g. noise around an
      // edge) keeps evenly spaced rows. Gaps and the last row stay so lines still break at gaps.
      const stride = Math.ceil(indices.length / maxPoints);
      return indices.filter(
        (index, j) =>
          j % stride === 0 ||
          j === indices.length - 1 ||
          Number.isNaN(xs[index]!) ||
          Number.isNaN(ys[index]!),
      );
    }
    // A line keeps about one row per `distance` pixels of its length: jump close to the cap
    distance *= Math.max(2, (1.2 * indices.length) / maxPoints);
  }
}
