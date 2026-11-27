// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import { ObjectData } from "@lichtblick/suite-base/components/Chart/types";

import { calculateIntervals } from "./downsample";
import type { PlotViewport } from "./types";

// Represents a point corresponding to a State Transition segment.
export type StatePoint = {
  // The x-coordinate of the point in the coordinate frame of the plot
  x: number;
  // The index of a point in the original dataset whose properties this segment
  // should include. If this is undefined, this segment consists of more than
  // one states and it should be rendered as such.
  index: number | undefined;
  states?: string[];
};

// Contains all of the state we need to keep track of for each interval.
type Interval = {
  // The x coordinate of the beginning of the interval
  x: number;
  // The pixel coordinate of the beginning of the interval
  xPixel: number;
  // The x coordinate of the end of the interval
  endX: number;
  // The index of the point that started the interval
  index: number;
  // Every label seen in this interval
  states: Set<string>;
  // The label of the last change in this interval, and its index
  lastLabel: string;
  lastIndex: number;
  // Whether a gap was folded into this interval, and the gap it ends with, if any
  hasGap: boolean;
  trailingGap?: StatePoint;
  // The last unlabelled repeat of the state in this interval, which ends its band
  lastRepeat?: StatePoint;
};

/** Points within this x range are kept; past it, only the nearest point on each side. */
function keptXRange({ bounds }: PlotViewport): { minX: number; maxX: number } {
  const xRange = bounds.x.max - bounds.x.min;
  return { minX: bounds.x.min - xRange * 0.5, maxX: bounds.x.max + xRange * 0.5 };
}

/**
 * The rows [start, end) of points sorted by x that `downsampleStates` uses for `view`: the kept
 * range plus the nearest point outside it on each side. Lets a long history skip what's off-screen.
 */
export function sortedStateWindow(
  data: readonly { x: number }[],
  view: PlotViewport,
): { start: number; end: number } {
  const { minX, maxX } = keptXRange(view);
  const start = Math.max(0, _.sortedIndexBy(data, { x: minX }, "x") - 1);
  const end = Math.min(data.length, _.sortedLastIndexBy(data, { x: maxX }, "x") + 1);
  return { start, end };
}

/**
 * Downsample state transition data by breaking the visible bounds into a set
 * of evenly-sized intervals and making a note of the number of state
 * transitions (between distinct states) that occur in each.
 *
 * If just one occurs, we return a StatePoint with x == the x-coordinate of the
 * single state transition point and index == the index of that point.
 *
 * If more than one does, it's represented in the output as two StatePoints:
 * one that matches the first point found in the interval (except with index ==
 * undefined) and another that matches the _last_ point in the interval, with x
 * == the end of the interval in the coordinate frame of the plot.
 *
 * This allows the caller to render intervals that contain more state
 * transitions than we can safely render in a different way to make it obvious
 * to the user that there is more detail.
 *
 * The `maxPoints` parameter works identically to the way it does in
 * `downsampleTimeseriesColumns`. Only rows [start, end) of `data` are read.
 */
export function downsampleStates(
  data: Readonly<ObjectData>,
  view: PlotViewport,
  maxPoints?: number,
  start = 0,
  end = data.length,
): StatePoint[] {
  const { pixelPerXValue } = calculateIntervals(view, 2, maxPoints);
  const xValuePerPixel = 1 / pixelPerXValue;

  const indices: StatePoint[] = [];
  let interval: Interval | undefined;

  // We keep points within a buffer window around the bounds so points near the bounds are
  // connected to their peers and available for pan/zoom.
  // Points outside this buffer window are dropped.
  const { minX, maxX } = keptXRange(view);

  // The nearest point on each side of the kept range. Rows needn't be sorted by x (header stamps).
  let before: StatePoint | undefined;
  let after: StatePoint | undefined;

  /**
   * Conclude the current interval, producing one or more StatePoint.
   *
   * If the interval contained just one state, we leave the original point in
   * place.
   *
   * If the interval contained multiple states, we produce two points:
   * * One at the x-value of the first point in the interval
   * * One at the x-value of the end of the interval (which is not a real point)
   * This allows the renderer to draw a gray line segment between these two points.
   */
  const finishInterval = (gapX?: number) => {
    if (interval == undefined) {
      return;
    }

    const { states, endX, trailingGap } = interval;
    const haveMultiple = states.size > 1 || interval.hasGap;

    indices.push({
      x: interval.x,
      index: haveMultiple ? undefined : interval.index,
      ...(haveMultiple ? { states: [...states] } : undefined),
    });

    if (!haveMultiple) {
      // Keep where the state was last seen so its band reaches up to a following gap or end.
      if (interval.lastRepeat) {
        indices.push(interval.lastRepeat);
      }
      return;
    }

    // Don't let the synthetic end run past a gap that starts within the same pixel.
    const gapStart = trailingGap?.x ?? gapX;
    indices.push({
      x: gapStart != undefined ? Math.min(endX, gapStart) : endX,
      index: interval.lastIndex,
    });
    if (trailingGap) {
      indices.push(trailingGap);
    }
  };

  // The pixel of the last gap pushed. One gap per pixel is drawn exactly; more fold in.
  let lastGapPixel: number | undefined;

  for (let index = start; index < end; index++) {
    const datum = data[index];
    if (datum == undefined) {
      continue;
    }
    const { label, x } = datum;

    if (x < minX) {
      if (before == undefined || x >= before.x) {
        before = { x, index };
      }
      continue;
    }
    if (x > maxX) {
      if (after == undefined || x < after.x) {
        after = { x, index };
      }
      continue;
    }

    const xPixel = Math.trunc(x * pixelPerXValue);

    // Unlabelled points repeat the previous state (shown points, segment ends) or mark a gap
    // (y = NaN). Within the open interval's pixel, a repeat moves where its band ends. A gap
    // closes the interval, so the same state after it isn't merged into the one before, unless
    // this pixel already drew a gap: then it folds in (the pixel shows as mixed), so a row
    // alternating with gaps stays a few output points per pixel.
    if (label == undefined) {
      const isGap = Number.isNaN(datum.y);
      if (interval?.xPixel === xPixel && (!isGap || lastGapPixel === xPixel)) {
        if (isGap) {
          interval.hasGap = true;
          interval.trailingGap = { x, index };
        } else {
          interval.lastRepeat = { x, index };
        }
        continue;
      }
      if (isGap && interval == undefined && lastGapPixel === xPixel) {
        continue;
      }
      finishInterval(isGap ? x : undefined);
      interval = undefined;
      indices.push({
        x,
        index,
      });
      if (isGap) {
        lastGapPixel = xPixel;
      }
      continue;
    }

    if (interval?.xPixel === xPixel) {
      interval.states.add(label);
      if (label !== interval.lastLabel) {
        interval.lastLabel = label;
        interval.lastIndex = index;
      }
      interval.trailingGap = undefined;
      continue;
    }

    finishInterval();
    interval = {
      x,
      endX: xPixel * xValuePerPixel + xValuePerPixel,
      xPixel,
      index,
      states: new Set([label]),
      lastLabel: label,
      lastIndex: index,
      hasGap: false,
    };
  }

  if (interval != undefined) {
    finishInterval();
  }

  if (before) {
    indices.unshift(before);
  }
  if (after) {
    indices.push({ x: maxX, index: after.index });
  }

  return indices;
}
