// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { applyModifier, MessagePathModifier, STREAM_MODIFIERS } from "@lichtblick/message-path";
import { Immutable } from "@lichtblick/suite";
import {
  MAX_POINTS,
  downsampleScatter,
  downsampleTimeseriesColumns,
} from "@lichtblick/suite-base/components/TimeBasedChart/downsample";
import type { Bounds1D } from "@lichtblick/suite-base/components/TimeBasedChart/types";
import { lowerBound, upperBound } from "@lichtblick/suite-base/util/sortedSearch";

import {
  CsvDataset,
  PlotAnalysis,
  SeriesConfigKey,
  SeriesItem,
  Viewport,
} from "./IDatasetsBuilder";
import type { GetViewportDatasetsResult } from "./IDatasetsBuilder";
import { DataItem, PointColumns } from "./columns";
import { buildDatasetStyle, isDerivedSeries } from "./utils";
import { Dataset } from "../types";
import { AnalysisColumns, computeHistogram, computeSpectrum } from "../utils/analysis";
import { Datum, OriginalValue } from "../utils/datum";

const EMPTY_PATHS: ReadonlySet<string> = new Set();

export type { DataItem } from "./columns";

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
  /**
   * Derived values of current rows, extended as rows arrive: rows [fullLength, upTo) of y. Kept
   * across thinning, so modifiers like `.@delta` stay computed over every input sample.
   */
  current?: { upTo: number; state: DeriveState };
};

type Series = {
  config: Immutable<SeriesItem>;
  /** full (preloaded) rows first, then current rows */
  points: PointColumns;
  fullLength: number;
  derived?: Derived;
  /** Current rows keep one in `keepEvery` samples; doubles each time they are halved */
  keepEvery: number;
  /** Samples in the open group of current rows (see #appendCurrent); 0 when none is open */
  headInputs: number;
  /** Recomputing the current values lost inputs already removed by thinning. */
  currentApproximate: boolean;
};

/**
 * Budget for current (live, not preloaded) rows per series, shared by all series of a plot. The
 * old fixed cap culled each series between 37.5k and 50k rows; this stays below its average, so
 * memory and redraw cost don't grow. Past it, the series with the most current rows is thinned
 * evenly instead of dropping its oldest data.
 */
const CURRENT_ROWS_PER_SERIES = 40_000;

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

/** The player's start time moved by `delta` seconds; x is relative to it, so shift every row. */
type ShiftXAction = {
  type: "shift-x";
  delta: number;
};

type UpdateSeriesConfigAction = {
  type: "update-series-config";
  seriesItems: SeriesItem[];
};

export type UpdateDataAction =
  | UpdateSeriesConfigAction
  | ShiftXAction
  | ResetSeriesFullAction
  | ResetSeriesCurrentAction
  | UpdateSeriesCurrentAction
  | UpdateSeriesFullAction;

type AnalysisResult = AnalysisColumns & { valueAt: (i: number) => OriginalValue };

/** Four significant digits, without trailing zeros */
const formatNumber = (value: number): string => String(Number(value.toPrecision(4)));

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

/**
 * Fill `dataset` with the rows of sorted columns that are in the viewport, downsampled to what the
 * viewport can show. Rows before `firstIdx` are skipped. `fullLength` is the number of preloaded
 * rows; a gap separates them from the current rows that follow.
 */
function downsampleInto(
  dataset: Dataset,
  xs: Float64Array,
  ys: Float64Array,
  count: number,
  firstIdx: number,
  fullLength: number,
  valueAt: (i: number) => OriginalValue,
  viewport: Immutable<Viewport>,
): void {
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
  // MIN_VALUE is the smallest positive number, so all-negative data needs -MAX_VALUE here
  let xMin = Number.MAX_VALUE;
  let xMax = -Number.MAX_VALUE;
  let yMin = Number.MAX_VALUE;
  let yMax = -Number.MAX_VALUE;
  let hasNaN = false;
  for (let i = startIdx; i < endIdx; i++) {
    const y = ys[i]!;
    if (Number.isNaN(y)) {
      hasNaN = true;
    } else if (needBounds && i >= firstInView && Number.isFinite(y)) {
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
        : downsampleScatter(xs, ys, startIdx, endIdx, downsampleViewport);
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
  let shouldAddNan = dataset.showLine === true && fullLength > 0;

  for (const index of downsampledIndices) {
    // Add a NaN entry to create a discontinuity between the full data and the current data and
    // avoid the "long interpolated line" during preloading if the current playback head is
    // later in the data
    if (shouldAddNan && index >= fullLength) {
      shouldAddNan = false;
      dataset.data.push({ x: NaN, y: NaN, value: NaN });
    }

    dataset.data.push({ x: xs[index]!, y: ys[index]!, value: valueAt(index) });
  }
}

export class TimestampDatasetsBuilderImpl {
  #seriesByKey = new Map<SeriesConfigKey, Series>();
  readonly #currentRowsPerSeries: number;

  public constructor(currentRowsPerSeries = CURRENT_ROWS_PER_SERIES) {
    this.#currentRowsPerSeries = currentRowsPerSeries;
  }
  /** Bumped on every data or series change; keys the analysis cache */
  #dataVersion = 0;
  #analysisCache?: { key: string; results: Map<SeriesConfigKey, AnalysisResult | undefined> };

  #viewportDatasets(viewport: Immutable<Viewport>): Dataset[] {
    if (viewport.analysis) {
      return this.#getAnalysisDatasets(viewport, viewport.analysis);
    }
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

      const ys = this.#getY(series);
      downsampleInto(
        dataset,
        series.points.x,
        ys,
        series.points.length,
        this.#firstIdx(series),
        series.fullLength,
        this.#valueGetter(series, ys),
        viewport,
      );
    }

    return datasets;
  }

  public getViewportDatasets(viewport: Immutable<Viewport>): GetViewportDatasetsResult {
    const datasetsByConfigIndex = this.#viewportDatasets(viewport);
    const approximateSeries: number[] = [];
    for (const series of this.#seriesByKey.values()) {
      if (series.config.enabled && series.currentApproximate && isDerivedSeries(series.config)) {
        approximateSeries.push(series.config.configIndex);
      }
    }
    return {
      datasetsByConfigIndex,
      pathsWithMismatchedDataLengths: EMPTY_PATHS,
      ...(approximateSeries.length > 0 && { approximateSeries }),
    };
  }

  /** The first datum of a cross-message modifier has no previous datum, so it has no value */
  #firstIdx(series: Series): number {
    return NEEDS_PREVIOUS.includes(series.config.parsed.modifier ?? "") ? 1 : 0;
  }

  /** Spectrum or histogram lines; cached until data, series or analysis settings change. */
  #getAnalysisDatasets(
    viewport: Immutable<Viewport>,
    analysis: Immutable<PlotAnalysis>,
  ): Dataset[] {
    const key = JSON.stringify([this.#dataVersion, analysis]) ?? "";
    let cache = this.#analysisCache;
    if (cache?.key !== key) {
      cache = { key, results: new Map() };
      this.#analysisCache = cache;
    }
    const { results } = cache;
    const datasets: Dataset[] = [];
    for (const series of this.#seriesByKey.values()) {
      if (!series.config.enabled) {
        continue;
      }
      if (!results.has(series.config.key)) {
        results.set(series.config.key, this.#analyze(series, analysis));
      }
      const result = results.get(series.config.key);
      const dataset: Dataset = {
        ...buildDatasetStyle(series.config),
        showLine: true,
        stepped: false,
        pointRadius: 0,
        data: [],
      };
      datasets[series.config.configIndex] = dataset;
      if (!result) {
        continue;
      }
      const { x, y, valueAt } = result;
      if (analysis.mode === "fft") {
        downsampleInto(dataset, x, y, x.length, 0, 0, valueAt, viewport);
      } else {
        // Downsampling would drop bin corners and draw diagonals. Bins are capped (2 points each),
        // so the visible part of the outline is drawn as is, plus one point on either side so
        // lines leave the view at the right height.
        const viewMin = viewport.bounds.x?.min;
        const viewMax = viewport.bounds.x?.max;
        const start =
          viewMin != undefined ? Math.max(lowerBound(x, 0, x.length, viewMin) - 1, 0) : 0;
        const end =
          viewMax != undefined
            ? Math.min(upperBound(x, 0, x.length, viewMax) + 1, x.length)
            : x.length;
        for (let i = start; i < end; i++) {
          dataset.data.push({ x: x[i]!, y: y[i]!, value: valueAt(i) });
        }
      }
    }
    return datasets;
  }

  #analyze(series: Series, analysis: Immutable<PlotAnalysis>): AnalysisResult | undefined {
    const ys = this.#getY(series);
    const { x: xs, length } = series.points;
    const min = analysis.timeRange?.min;
    const max = analysis.timeRange?.max;
    const start = Math.max(
      this.#firstIdx(series),
      min != undefined ? lowerBound(xs, 0, length, min) : 0,
    );
    const end = max != undefined ? upperBound(xs, 0, length, max) : length;

    if (analysis.mode === "fft") {
      const spectrum = computeSpectrum(xs, ys, start, end);
      return (
        spectrum && {
          ...spectrum,
          valueAt: (i) => `${formatNumber(spectrum.y[i]!)} @ ${formatNumber(spectrum.x[i]!)} Hz`,
        }
      );
    }
    const histogram = computeHistogram(ys, start, end, analysis.bins);
    if (!histogram) {
      return undefined;
    }
    const { edges, counts } = histogram;
    return {
      x: histogram.x,
      y: histogram.y,
      valueAt: (i) => {
        // Outline points 2b+1 and 2b+2 are the top corners of bin b
        const bin = Math.min(Math.max((i - 1) >> 1, 0), counts.length - 1);
        return `${counts[bin]} in [${formatNumber(edges[bin]!)}, ${formatNumber(edges[bin + 1]!)}]`;
      },
    };
  }

  /**
   * The plotted value of each derived series (see `isDerivedSeries`) at `x`: its last sample at or
   * before `x`, indexed by config index. Other series are left out.
   */
  public getDerivedValuesAt(x: number): (OriginalValue | undefined)[] {
    const values: (OriginalValue | undefined)[] = [];
    for (const series of this.#seriesByKey.values()) {
      if (!series.config.enabled || !isDerivedSeries(series.config)) {
        continue;
      }
      const { points } = series;
      const i = upperBound(points.x, 0, points.length, x) - 1;
      if (i < this.#firstIdx(series)) {
        continue;
      }
      const ys = this.#getY(series);
      values[series.config.configIndex] = this.#valueGetter(series, ys)(i);
    }
    return values;
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
   * only extended when rows are appended. Current rows extend their own copy of the state, which
   * is dropped when current rows are reset or reordered.
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
      y.set(derived.y.subarray(0, Math.max(derived.upTo, derived.current?.upTo ?? 0)));
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
    if (derived.upTo !== fullLength) {
      derived.upTo = fullLength;
      derived.current = undefined;
    }
    if (!derived.current) {
      // Late rows or changes to the derivation invalidate its running state. Once live rows
      // have been thinned, restarting can only use the rows we still have.
      series.currentApproximate = series.keepEvery > 1;
      derived.current = { upTo: fullLength, state: cloneDeriveState(derived.state) };
    }
    const { current } = derived;
    deriveRows(
      points,
      current.upTo,
      points.length,
      derived.y,
      current.state,
      modifier,
      modifiersAfter,
    );
    current.upTo = points.length;
    return derived.y;
  }

  /** Rows from `row` on changed; drop cached derived values from there. */
  #invalidate(series: Series, row: number): void {
    if (series.derived && row < series.derived.upTo) {
      // The running state is only kept at the cache end, so recompute from the start.
      // Out-of-order inserts into preloaded rows are rare (blocks load in time order).
      series.derived = undefined;
    }
  }

  /**
   * Append a current row. With `keepEvery` > 1, every `keepEvery` samples fold into one row: while
   * a group is open, its second-to-last row holds the sample furthest from the row before it (so
   * one-sample spikes survive) and its last row the newest sample, which is always plotted. A
   * finished group keeps the more extreme of the two. Gaps (NaN) are never folded.
   */
  #appendCurrent(series: Series, item: Immutable<DataItem>): void {
    const { points } = series;
    const gap = Number.isNaN(item.y);
    if (gap) {
      // A gap ends the open group as it is: its newest row stays, so the line reaches it
      series.headInputs = 0;
    } else if (series.headInputs >= 2) {
      // Derived values consume the samples being replaced first, so modifiers see every sample
      const ys = this.#getY(series);
      const newest = points.length - 1;
      const extreme = newest - 1;
      const ref = ys[Math.max(extreme - 1, 0)]!;
      if (Number.isNaN(ys[extreme]!) || Number.isNaN(ys[newest]!)) {
        // a derived gap: leave both rows as they are
        series.headInputs = 0;
      } else {
        if (Math.abs(ys[newest]! - ref) >= Math.abs(ys[extreme]! - ref)) {
          points.copyRow(newest, extreme);
          ys[extreme] = ys[newest]!;
        }
        const current = series.derived?.current;
        if (current) {
          current.upTo = newest;
        }
        if (series.headInputs < series.keepEvery) {
          points.set(newest, item);
          series.headInputs++;
          return;
        }
        points.truncate(newest);
        series.headInputs = 0;
      }
    }
    const grow = series.headInputs > 0 && series.headInputs < series.keepEvery;
    points.push(item);
    series.headInputs = gap ? 0 : grow ? series.headInputs + 1 : 1;
  }

  /**
   * Halve the current rows of the series with the most of them until all fit the budget. Older
   * data loses resolution evenly (later samples are kept at the same rate) instead of being cut.
   */
  #enforceCurrentBudget(): boolean {
    let total = 0;
    for (const series of this.#seriesByKey.values()) {
      total += series.points.length - series.fullLength;
    }
    let thinned = false;
    const budget = this.#currentRowsPerSeries * this.#seriesByKey.size;
    while (total > budget) {
      let largest: Series | undefined;
      for (const series of this.#seriesByKey.values()) {
        const rows = series.points.length - series.fullLength;
        if (!largest || rows > largest.points.length - largest.fullLength) {
          largest = series;
        }
      }
      if (largest) {
        // derive every current row before thinning, then thin the derived values along with them
        this.#getY(largest);
      }
      const current = largest?.derived?.current;
      const extra = current ? [largest!.derived!.y] : [];
      const removed = largest?.points.halve(largest.fullLength, extra) ?? 0;
      if (current) {
        current.upTo = largest!.points.length;
      }
      if (!largest || removed === 0) {
        break;
      }
      largest.keepEvery *= 2;
      // the next sample starts a new group
      largest.headInputs = 0;
      total -= removed;
      thinned = true;
    }
    return thinned;
  }

  public applyActions(actions: Immutable<UpdateDataAction[]>): void {
    for (const action of actions) {
      this.applyAction(action);
    }
  }

  public applyAction(action: Immutable<UpdateDataAction>): void {
    // Appends bump the version themselves, only when they change data
    if (action.type !== "append-current") {
      this.#dataVersion += 1;
    }
    switch (action.type) {
      case "reset-current": {
        const series = this.#seriesByKey.get(action.series);
        if (!series) {
          return;
        }
        series.points.truncate(series.fullLength);
        if (series.derived) {
          series.derived.current = undefined;
        }
        series.keepEvery = 1;
        series.headInputs = 0;
        series.currentApproximate = false;
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
        const lengthBefore = points.length;

        // trim current data to remove values present in the full data
        const lastX = fullLength > 0 ? points.x[fullLength - 1] : undefined;

        // Message times other than receive time can arrive out of order
        const needsSort = series.config.timestampMethod !== "receiveTime";
        const items = (needsSort ? action.items.toSorted(compareDatum) : action.items).filter(
          (item) => lastX == undefined || item.x > lastX,
        );
        // Items before the newest current row merge into place; the rest append (thinned)
        const newestX = points.length > fullLength ? points.x[points.length - 1]! : -Infinity;
        let split = 0;
        while (needsSort && split < items.length && items[split]!.x < newestX) {
          split++;
        }
        if (split > 0) {
          points.insert(fullLength, items.slice(0, split), points.length);
          series.headInputs = 0;
          if (series.derived) {
            series.derived.current = undefined;
          }
        }
        for (let i = split; i < items.length; i++) {
          this.#appendCurrent(series, items[i]!);
        }
        const thinned = this.#enforceCurrentBudget();
        if (thinned || items.length > 0 || points.length !== lengthBefore) {
          this.#dataVersion += 1;
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
          const sorted = action.items.toSorted(compareDatum);
          this.#invalidate(series, points.insert(0, sorted, oldFullLength));
        } else if (oldFullLength > 0 && action.items[0]!.x < points.x[oldFullLength - 1]!) {
          // Earlier history (read around the playhead first): in order itself, merged into place
          this.#invalidate(series, points.insert(0, action.items, oldFullLength));
        } else {
          points.insert(oldFullLength, action.items);
        }
        if (series.derived) {
          // current rows shift and get trimmed below
          series.derived.current = undefined;
        }
        series.fullLength = oldFullLength + action.items.length;
        series.headInputs = 0;

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
        if (points.length === fullLength) {
          series.keepEvery = 1;
          series.headInputs = 0;
          series.currentApproximate = false;
        }
        break;
      }
      case "shift-x": {
        // Stream modifiers and smoothing only use x differences, so derived values stay valid
        for (const { points, derived } of this.#seriesByKey.values()) {
          for (let i = 0; i < points.length; i++) {
            points.x[i]! -= action.delta;
          }
          // the cached running state continues from the last derived row
          if (derived) {
            derived.state.prevX -= action.delta;
            if (derived.current) {
              derived.current.state.prevX -= action.delta;
            }
          }
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
            keepEvery: 1,
            headInputs: 0,
            currentApproximate: false,
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
