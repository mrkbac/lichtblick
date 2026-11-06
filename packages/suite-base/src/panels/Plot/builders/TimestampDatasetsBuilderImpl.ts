// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { applyModifier, MessagePathModifier, STREAM_MODIFIERS } from "@lichtblick/message-path";
import { Immutable, Time } from "@lichtblick/suite";
import { Point } from "@lichtblick/suite-base/components/Chart/datasets";
import {
  MAX_POINTS,
  downsampleScatter,
  downsampleTimeseriesColumns,
} from "@lichtblick/suite-base/components/TimeBasedChart/downsample";
import type { Bounds1D } from "@lichtblick/suite-base/components/TimeBasedChart/types";

import { CsvDataset, SeriesConfigKey, SeriesItem, Viewport } from "./IDatasetsBuilder";
import { MAX_CURRENT_DATUMS_PER_SERIES, buildDatasetStyle } from "./utils";
import { Dataset } from "../types";
import { Datum, OriginalValue } from "../utils/datum";

export type DataItem = Datum & {
  receiveTime: Time;
  headerStamp?: Time;
};

/**
 * Growable columnar point storage. A point costs ~36 bytes here instead of a ~200 byte object
 * graph (datum + receive time + header stamp objects). The original value is only kept when it is
 * not simply `y` (strings, bigints, times...).
 */
class PointColumns {
  public length = 0;
  public x = new Float64Array(0);
  public y = new Float64Array(0);
  #receiveSec = new Float64Array(0);
  #receiveNsec = new Uint32Array(0);
  /** NaN when the point has no header stamp */
  #stampSec = new Float64Array(0);
  #stampNsec = new Uint32Array(0);
  /** undefined entries mean "value is y" (or null for a NaN y) */
  #values: (OriginalValue | undefined)[] | undefined;

  public value(i: number): OriginalValue {
    const value = this.#values?.[i];
    // null is a stored value (a gap); only undefined means "derive from y"
    // eslint-disable-next-line @lichtblick/strict-equality
    if (value !== undefined) {
      return value;
    }
    const y = this.y[i]!;
    return Number.isNaN(y) ? null : y;
  }

  public receiveTime(i: number): Time {
    return { sec: this.#receiveSec[i]!, nsec: this.#receiveNsec[i]! };
  }

  public headerStamp(i: number): Time | undefined {
    const sec = this.#stampSec[i]!;
    return Number.isNaN(sec) ? undefined : { sec, nsec: this.#stampNsec[i]! };
  }

  public push(item: Immutable<DataItem>): void {
    this.#reserve(this.length + 1);
    const i = this.length++;
    this.x[i] = item.x;
    this.y[i] = item.y;
    this.#receiveSec[i] = item.receiveTime.sec;
    this.#receiveNsec[i] = item.receiveTime.nsec;
    this.#stampSec[i] = item.headerStamp?.sec ?? Number.NaN;
    this.#stampNsec[i] = item.headerStamp?.nsec ?? 0;
    const value = item.value;
    // eslint-disable-next-line @lichtblick/strict-equality
    const derivable = value === item.y || (value === null && Number.isNaN(item.y));
    if (!derivable) {
      this.#values ??= [];
      this.#values[i] = value;
    } else if (this.#values) {
      this.#values[i] = undefined;
    }
  }

  /** Remove rows [start, end) */
  public remove(start: number, end: number): void {
    const stop = Math.min(end, this.length);
    if (stop <= start) {
      return;
    }
    for (const col of this.#columns()) {
      col.copyWithin(start, stop, this.length);
    }
    this.#values?.splice(start, stop - start);
    this.length -= stop - start;
  }

  /**
   * Insert `items` before row `at`. With `mergeUntil`, `items` must be sorted by x and the rows
   * [at, mergeUntil) are merged with them by x (existing rows first on ties, like a stable sort);
   * rows from `mergeUntil` on stay after the inserted ones. Returns the first changed row.
   */
  public insert(insertAt: number, items: Immutable<DataItem[]>, mergeUntil = insertAt): number {
    if (items.length === 0) {
      return this.length;
    }
    // only rows after the first item's x take part in the merge
    const at =
      mergeUntil > insertAt ? upperBound(this.x, insertAt, mergeUntil, items[0]!.x) : insertAt;
    const tail = this.#slice(at);
    this.length = at;
    let t = 0;
    for (const item of items) {
      while (t < mergeUntil - at && tail.x[t]! <= item.x) {
        this.#pushRow(tail, t++);
      }
      this.push(item);
    }
    for (; t < tail.length; t++) {
      this.#pushRow(tail, t);
    }
    return at;
  }

  #pushRow(src: PointColumns, i: number): void {
    this.#reserve(this.length + 1);
    const j = this.length++;
    this.x[j] = src.x[i]!;
    this.y[j] = src.y[i]!;
    this.#receiveSec[j] = src.#receiveSec[i]!;
    this.#receiveNsec[j] = src.#receiveNsec[i]!;
    this.#stampSec[j] = src.#stampSec[i]!;
    this.#stampNsec[j] = src.#stampNsec[i]!;
    if (src.#values || this.#values) {
      this.#values ??= [];
      this.#values[j] = src.#values?.[i];
    }
  }

  #slice(start: number): PointColumns {
    const out = new PointColumns();
    out.length = Math.max(0, this.length - start);
    out.x = this.x.slice(start, this.length);
    out.y = this.y.slice(start, this.length);
    out.#receiveSec = this.#receiveSec.slice(start, this.length);
    out.#receiveNsec = this.#receiveNsec.slice(start, this.length);
    out.#stampSec = this.#stampSec.slice(start, this.length);
    out.#stampNsec = this.#stampNsec.slice(start, this.length);
    out.#values = this.#values?.slice(start, this.length);
    return out;
  }

  #columns(): (Float64Array | Uint32Array)[] {
    return [this.x, this.y, this.#receiveSec, this.#receiveNsec, this.#stampSec, this.#stampNsec];
  }

  #reserve(size: number): void {
    if (size <= this.x.length) {
      return;
    }
    const capacity = Math.max(1024, Math.ceil(size * 1.5));
    const grow = <T extends Float64Array | Uint32Array>(col: T, make: (n: number) => T): T => {
      const next = make(capacity);
      next.set(col.subarray(0, this.length));
      return next;
    };
    const f64 = (n: number) => new Float64Array(n);
    const u32 = (n: number) => new Uint32Array(n);
    this.x = grow(this.x, f64);
    this.y = grow(this.y, f64);
    this.#receiveSec = grow(this.#receiveSec, f64);
    this.#receiveNsec = grow(this.#receiveNsec, u32);
    this.#stampSec = grow(this.#stampSec, f64);
    this.#stampNsec = grow(this.#stampNsec, u32);
  }
}

/** First index in [lo, hi) whose x is > value (or hi) */
function upperBound(xs: Float64Array, from: number, to: number, value: number): number {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid]! <= value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** First index in [lo, hi) whose x is >= value (or hi) */
function lowerBound(xs: Float64Array, from: number, to: number, value: number): number {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid]! < value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** Running state of the stream modifier and moving average, so derived values extend on append. */
type DeriveState = {
  hasPrev: boolean;
  prevX: number;
  prevY: number;
  integral: number;
  /** moving-average ring over the stream-modified values */
  ring: Float64Array;
  ringHead: number;
  ringCount: number;
  ringSum: number;
};

type Derived = {
  key: string;
  y: Float64Array;
  /** rows [0, upTo) of y are valid; always within the full (preloaded) rows */
  upTo: number;
  state: DeriveState;
};

type Series = {
  config: Immutable<SeriesItem>;
  /** full (preloaded) rows first, then current rows */
  points: PointColumns;
  fullLength: number;
  derived?: Derived;
};

type ResetSeriesFullAction = {
  type: "reset-full";
  series: SeriesConfigKey;
};

type ResetSeriesCurrentAction = {
  type: "reset-current";
  series: SeriesConfigKey;
};

type UpdateSeriesCurrentAction = {
  type: "append-current";
  series: SeriesConfigKey;
  items: DataItem[];
};

type UpdateSeriesFullAction = {
  type: "append-full";
  series: SeriesConfigKey;
  items: DataItem[];
};

type UpdateSeriesConfigAction = {
  type: "update-series-config";
  seriesItems: SeriesItem[];
};

export type UpdateDataAction =
  | UpdateSeriesConfigAction
  | ResetSeriesFullAction
  | ResetSeriesCurrentAction
  | UpdateSeriesCurrentAction
  | UpdateSeriesFullAction;

const compareDatum = (a: Immutable<Datum>, b: Immutable<Datum>) => a.x - b.x;

/** Cross-message modifiers whose first datum has no previous datum to compare against. */
const NEEDS_PREVIOUS = ["derivative", "delta", "timedelta"];

function newDeriveState(windowSize: number): DeriveState {
  return {
    hasPrev: false,
    prevX: 0,
    prevY: 0,
    integral: 0,
    ring: new Float64Array(Math.max(windowSize, 0)),
    ringHead: 0,
    ringCount: 0,
    ringSum: 0,
  };
}

function cloneDeriveState(state: DeriveState): DeriveState {
  return { ...state, ring: state.ring.slice() };
}

/**
 * Compute derived y for rows [from, to): a time-series modifier like `.@delta` followed by the
 * scalar modifiers after it, then a trailing moving average (a NaN sample restarts its window).
 */
function deriveRows(
  points: PointColumns,
  from: number,
  to: number,
  out: Float64Array,
  state: DeriveState,
  modifier: string | undefined,
  modifiersAfter: Immutable<MessagePathModifier[]>,
): void {
  const windowSize = state.ring.length;
  for (let i = from; i < to; i++) {
    const x = points.x[i]!;
    let y = points.y[i]!;
    if (modifier != undefined) {
      const valid = !Number.isNaN(x) && !Number.isNaN(y);
      let result = Number.NaN;
      if (valid) {
        switch (modifier) {
          case "derivative":
            result =
              state.hasPrev && x !== state.prevX ? (y - state.prevY) / (x - state.prevX) : NaN;
            break;
          case "delta":
            result = state.hasPrev ? y - state.prevY : Number.NaN;
            break;
          case "timedelta":
            result = state.hasPrev ? x - state.prevX : Number.NaN;
            break;
          case "integral":
            // Trapezoidal rule. Gaps (NaN values) contribute nothing.
            if (state.hasPrev) {
              state.integral += ((y + state.prevY) / 2) * (x - state.prevX);
            }
            result = state.integral;
            break;
        }
      }
      for (const after of modifiersAfter) {
        const modified = Number.isNaN(result) ? result : applyModifier(result, after);
        result = typeof modified === "number" ? modified : Number.NaN;
      }
      state.hasPrev = valid;
      state.prevX = x;
      state.prevY = y;
      y = result;
    }
    if (windowSize > 1) {
      if (Number.isNaN(y)) {
        state.ringSum = 0;
        state.ringCount = 0;
      } else {
        // Same operation order as a plain running sum so results match exactly
        state.ringSum += y;
        if (state.ringCount === windowSize) {
          state.ringSum -= state.ring[state.ringHead]!;
          state.ring[state.ringHead] = y;
          state.ringHead = (state.ringHead + 1) % windowSize;
        } else {
          state.ring[(state.ringHead + state.ringCount) % windowSize] = y;
          state.ringCount += 1;
        }
        y = state.ringSum / state.ringCount;
      }
    }
    out[i] = y;
  }
}

/** Point view over columns for the shared downsamplers; the yielded object is reused. */
function* iteratePoints(xs: Float64Array, ys: Float64Array, start: number, end: number) {
  const point: Point = { index: 0, x: 0, y: 0 };
  for (let i = start; i < end; i++) {
    point.index = i;
    point.x = xs[i]!;
    point.y = ys[i]!;
    yield point;
  }
}

export class TimestampDatasetsBuilderImpl {
  #seriesByKey = new Map<SeriesConfigKey, Series>();

  public getViewportDatasets(viewport: Immutable<Viewport>): Dataset[] {
    const datasets: Dataset[] = [];
    for (const series of this.#seriesByKey.values()) {
      if (!series.config.enabled) {
        continue;
      }
      const dataset: Dataset = {
        ...buildDatasetStyle(series.config),
        data: [],
      };

      datasets[series.config.configIndex] = dataset;

      const { points } = series;
      const count = points.length;
      const xs = points.x;
      const ys = this.#getY(series);
      const valueAt = this.#valueGetter(series, ys);

      // The first datum has no previous datum, so it has no value
      const firstIdx = NEEDS_PREVIOUS.includes(series.config.parsed.modifier ?? "") ? 1 : 0;

      // Trim the dataset down to the view area. Include one point on either side so it appears
      // to extend out of the view area. Points are sorted by x.
      const viewMin = viewport.bounds.x?.min;
      const viewMax = viewport.bounds.x?.max;
      const firstInView = viewMin != undefined ? lowerBound(xs, 0, count, viewMin) : 0;
      const afterView = viewMax != undefined ? upperBound(xs, 0, count, viewMax) : count;
      const startIdx = Math.max(firstIdx, firstInView - 1);
      const endIdx = Math.min(afterView + 1, count);

      const needBounds =
        viewMin == undefined ||
        viewMax == undefined ||
        viewport.bounds.y?.min == undefined ||
        viewport.bounds.y.max == undefined;
      // Bounds skip the point before the view; plain locals keep this hot loop fast
      let xMin = Number.MAX_VALUE;
      let xMax = Number.MIN_VALUE;
      let yMin = Number.MAX_VALUE;
      let yMax = Number.MIN_VALUE;
      let hasNaN = false;
      for (let i = startIdx; i < endIdx; i++) {
        const y = ys[i]!;
        if (Number.isNaN(y)) {
          hasNaN = true;
        } else if (needBounds && i >= firstInView) {
          yMin = y < yMin ? y : yMin;
          yMax = y > yMax ? y : yMax;
        }
        const x = xs[i]!;
        if (needBounds && i >= firstInView && !Number.isNaN(x)) {
          xMin = x < xMin ? x : xMin;
          xMax = x > xMax ? x : xMax;
        }
      }

      const downsampleViewport = {
        width: viewport.size.width,
        height: viewport.size.height,
        bounds: {
          x: { min: viewMin ?? xMin, max: viewMax ?? xMax },
          y: {
            min: viewport.bounds.y?.min ?? yMin,
            max: viewport.bounds.y?.max ?? yMax,
          },
        },
      };

      // Each series gets its own budget: dividing a shared budget between series made plots with
      // many series coarse and jittery. The downsampler also caps points by pixel width.
      const maxPoints = MAX_POINTS;

      // We already have fewer items than the viewport width so there's no need to downsample
      //
      // Points could still "overlap" but we don't care because we are under our threshold for
      // the number of points we want to return for a dataset.
      //
      // This avoids situations where downsampling might resolve datums to the same pixel at
      // different zoom levels (due to pixel rounding for datums) as we zoom in and cause us to
      // remove data points and hide dots. This creates a counter-intuitive UX where dots can
      // dissapear when zooming in.
      const min = Math.min(downsampleViewport.width, maxPoints);
      const numItems = Math.max(0, endIdx - startIdx);

      let downsampledIndices: number[];
      if (numItems < min) {
        downsampledIndices = [];
        for (let i = startIdx; i < endIdx; i++) {
          downsampledIndices.push(i);
        }
      } else {
        // first/min/max/last per pixel column keeps spikes, and every drawn point is a real
        // sample, so tooltips on downsampled data show real values
        downsampledIndices =
          dataset.showLine === true
            ? downsampleTimeseriesColumns(xs, ys, startIdx, endIdx, downsampleViewport, maxPoints)
            : downsampleScatter(iteratePoints(xs, ys, startIdx, endIdx), downsampleViewport);
      }

      if (dataset.showLine === true && hasNaN && downsampledIndices.length < numItems) {
        // Keep every gap so lines break where the data does
        const downsampledIndexSet = new Set(downsampledIndices);
        for (let i = startIdx; i < endIdx; i++) {
          if (Number.isNaN(ys[i]!) && !downsampledIndexSet.has(i)) {
            downsampledIndices.push(i);
          }
        }
        downsampledIndices.sort((a, b) => a - b);
      }

      // When a series is downsampled the points are disabled as a visual indicator that
      // data is downsampled.
      //
      // If show line is false then we must show points otherwise nothing will be displayed
      if (downsampledIndices.length < numItems && dataset.showLine === true) {
        dataset.pointRadius = 0;
      }

      // We only need to add the NaN entry if using lines and there is both full and current data
      // to create a discontinuity after the full data.
      let shouldAddNan = dataset.showLine === true && series.fullLength > 0;

      for (const index of downsampledIndices) {
        // Add a NaN entry to create a discontinuity between the full data and the current data and
        // avoid the "long interpolated line" during preloading if the current playback head is
        // later in the data
        if (shouldAddNan && index >= series.fullLength) {
          shouldAddNan = false;
          dataset.data.push({ x: NaN, y: NaN, value: NaN });
        }

        dataset.data.push({ x: xs[index]!, y: ys[index]!, value: valueAt(index) });
      }
    }

    return datasets;
  }

  public getCsvData(xRange?: Immutable<Bounds1D>): CsvDataset[] {
    const datasets: CsvDataset[] = [];
    for (const series of this.#seriesByKey.values()) {
      if (!series.config.enabled) {
        continue;
      }

      const { points } = series;
      const ys = this.#getY(series);
      const valueAt = this.#valueGetter(series, ys);
      const data: CsvDataset["data"] = [];
      for (let i = 0; i < points.length; i++) {
        const x = points.x[i]!;
        if (xRange && (x < xRange.min || x > xRange.max)) {
          continue;
        }
        data.push({
          x,
          y: ys[i]!,
          receiveTime: points.receiveTime(i),
          headerStamp: points.headerStamp(i),
          value: valueAt(i),
        });
      }
      datasets.push({
        label: series.config.messagePath,
        configIndex: series.config.configIndex,
        data,
      });
    }

    return datasets;
  }

  /** Tooltips and CSV show the derived value, like they do for derivatives. */
  #valueGetter(series: Series, ys: Float64Array): (i: number) => OriginalValue {
    const { points } = series;
    if (ys === points.y) {
      return (i) => points.value(i);
    }
    const hasModifier = this.#streamModifier(series) != undefined;
    return (i) => {
      const y = ys[i]!;
      if (Number.isNaN(y)) {
        return hasModifier ? null : points.value(i);
      }
      return y;
    };
  }

  #streamModifier(series: Series): string | undefined {
    const { modifier } = series.config.parsed;
    return modifier != undefined && STREAM_MODIFIERS.includes(modifier) ? modifier : undefined;
  }

  /**
   * y values after stream modifiers and smoothing. Derived values of preloaded rows are cached and
   * only extended when rows are appended; current rows are cheap (capped) and derived each time.
   */
  #getY(series: Series): Float64Array {
    const modifier = this.#streamModifier(series);
    const { modifiersAfter = [] } = series.config.parsed;
    const smoothing = Math.round(series.config.smoothing ?? 0);
    if (modifier == undefined && smoothing <= 1) {
      series.derived = undefined;
      return series.points.y;
    }

    const key = JSON.stringify([modifier, modifiersAfter, smoothing]) ?? "";
    const { points, fullLength } = series;
    let derived = series.derived;
    if (derived == undefined || derived.key !== key) {
      derived = { key, y: new Float64Array(0), upTo: 0, state: newDeriveState(smoothing) };
      series.derived = derived;
    }
    if (derived.y.length < points.x.length) {
      const y = new Float64Array(points.x.length);
      y.set(derived.y.subarray(0, derived.upTo));
      derived.y = y;
    }
    deriveRows(
      points,
      derived.upTo,
      fullLength,
      derived.y,
      derived.state,
      modifier,
      modifiersAfter,
    );
    derived.upTo = fullLength;
    const currentState = cloneDeriveState(derived.state);
    deriveRows(
      points,
      fullLength,
      points.length,
      derived.y,
      currentState,
      modifier,
      modifiersAfter,
    );
    return derived.y;
  }

  /** Rows from `row` on changed; drop cached derived values from there. */
  #invalidate(series: Series, row: number): void {
    if (series.derived && row < series.derived.upTo) {
      // ponytail: the running state is only kept at the cache end, so recompute from the start.
      // Out-of-order inserts into preloaded rows are rare (blocks load in time order).
      series.derived = undefined;
    }
  }

  public applyActions(actions: Immutable<UpdateDataAction[]>): void {
    for (const action of actions) {
      this.applyAction(action);
    }
  }

  public applyAction(action: Immutable<UpdateDataAction>): void {
    switch (action.type) {
      case "reset-current": {
        const series = this.#seriesByKey.get(action.series);
        if (!series) {
          return;
        }
        series.points.length = series.fullLength;
        break;
      }
      case "reset-full": {
        const series = this.#seriesByKey.get(action.series);
        if (!series) {
          return;
        }
        // keeps the underlying memory since we typically expect to fill it again
        series.points.remove(0, series.fullLength);
        series.fullLength = 0;
        this.#invalidate(series, 0);
        break;
      }
      case "append-current": {
        const series = this.#seriesByKey.get(action.series);
        if (!series) {
          return;
        }
        const { points, fullLength } = series;

        // trim current data to remove values present in the full data
        const lastX = fullLength > 0 ? points.x[fullLength - 1] : undefined;

        // Limit the total current datums for any series so they do not grow indefinitely
        const currentLength = points.length - fullLength;
        const cullSize = Math.max(
          0,
          currentLength + action.items.length - MAX_CURRENT_DATUMS_PER_SERIES,
        );

        // cull more than max so we don't have to cull again immediately
        if (cullSize > 0) {
          points.remove(fullLength, fullLength + cullSize + MAX_CURRENT_DATUMS_PER_SERIES * 0.25);
        }

        // Message times other than receive time can arrive out of order
        const needsSort = series.config.timestampMethod !== "receiveTime";
        const items = (needsSort ? action.items.slice().sort(compareDatum) : action.items).filter(
          (item) => lastX == undefined || item.x > lastX,
        );
        if (needsSort) {
          points.insert(fullLength, items, points.length);
        } else {
          points.insert(points.length, items);
        }
        break;
      }
      case "append-full": {
        const series = this.#seriesByKey.get(action.series);
        if (!series) {
          return;
        }
        const { points } = series;
        const oldFullLength = series.fullLength;

        if (series.config.timestampMethod !== "receiveTime") {
          // Batches are mostly already in order: merge instead of re-sorting everything
          const sorted = action.items.slice().sort(compareDatum);
          this.#invalidate(series, points.insert(0, sorted, oldFullLength));
        } else {
          points.insert(oldFullLength, action.items);
        }
        series.fullLength = oldFullLength + action.items.length;

        // trim current data to remove values present in the full data
        const fullLength = series.fullLength;
        if (fullLength > 0) {
          const lastX = points.x[fullLength - 1]!;
          let idx = fullLength;
          while (idx < points.length && points.x[idx]! <= lastX) {
            idx += 1;
          }
          points.remove(fullLength, idx);
        }
        break;
      }
      case "update-series-config": {
        const newSeries = new Map<SeriesConfigKey, Series>();
        for (const config of action.seriesItems) {
          const series = this.#seriesByKey.get(config.key) ?? {
            config,
            points: new PointColumns(),
            fullLength: 0,
          };
          series.config = config;
          newSeries.set(config.key, series);
        }
        this.#seriesByKey = newSeries;
        break;
      }
    }
  }
}
