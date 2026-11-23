// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { compare } from "@foxglove/rostime";

import { Immutable, Time } from "@lichtblick/suite";
import {
  MAX_POINTS,
  downsamplePathColumns,
  downsampleScatter,
} from "@lichtblick/suite-base/components/TimeBasedChart/downsample";
import { Bounds1D } from "@lichtblick/suite-base/components/TimeBasedChart/types";

import {
  CsvDataset,
  GetViewportDatasetsResult,
  SeriesConfigKey,
  SeriesItem,
  Viewport,
} from "./IDatasetsBuilder";
import { DataItem, PointColumns } from "./columns";
import { buildDatasetStyle } from "./utils";
import { Dataset } from "../types";
import { OriginalValue } from "../utils/datum";

export type ValueItem = {
  /** Set when the series has its own x path; otherwise x comes from the panel's x-axis path. */
  x?: number;
  value: number;
  originalValue: OriginalValue;
  receiveTime: Time;
};

/** Rows in receive order: full (preloaded) rows first, then current rows */
type Stream = {
  points: PointColumns;
  fullLength: number;
};

type Series = Stream & {
  config: Immutable<SeriesItem>;
  /**
   * Without its own x path, `points.x` holds the x-axis value paired with each row. Rows before
   * `pairedUpTo` are paired for good; later ones are paired again on each read.
   */
  pairedUpTo: number;
  /**
   * Last rows of messages whose value count differs from their x-axis message's, in row order.
   * Entries from `pairedUpTo` on are found again on each pairing.
   */
  mismatchRows: number[];
};

type ResetSeriesFullAction = {
  type: "reset-full";
  series: SeriesConfigKey;
};

type ResetSeriesCurrentAction = {
  type: "reset-current";
  series: SeriesConfigKey;
};

type ResetCurrentXAction = {
  type: "reset-current-x";
};

type ResetFullXAction = {
  type: "reset-full-x";
};

type UpdateCurrentXAction = {
  type: "append-current-x";
  items: ValueItem[];
};

type UpdateFullXAction = {
  type: "append-full-x";
  items: ValueItem[];
};

type UpdateSeriesCurrentAction = {
  type: "append-current";
  series: SeriesConfigKey;
  items: ValueItem[];
};

type UpdateSeriesFullAction = {
  type: "append-full";
  series: SeriesConfigKey;
  items: ValueItem[];
};

type UpdateSeriesConfigAction = {
  type: "update-series-config";
  seriesItems: SeriesItem[];
};

export type UpdateDataAction =
  | UpdateSeriesConfigAction
  | ResetSeriesFullAction
  | ResetSeriesCurrentAction
  | ResetCurrentXAction
  | ResetFullXAction
  | UpdateCurrentXAction
  | UpdateFullXAction
  | UpdateSeriesCurrentAction
  | UpdateSeriesFullAction;

/**
 * Budget for current (live, not preloaded) rows, per stream (the x-axis and each series), shared by
 * all of them. It stays below the average fill of the old 50k cap, so memory doesn't grow; past it,
 * live data is thinned evenly in time instead of dropping its oldest part.
 */
const CURRENT_ROWS_PER_STREAM = 40_000;

const newStream = (): Stream => ({ points: new PointColumns(), fullLength: 0 });

/** Start of the message (rows with the same receive time) that ends just before row `end` */
function messageStart(points: PointColumns, end: number, floor: number): number {
  let start = end - 1;
  while (start > floor && points.sameReceive(start - 1, end - 1)) {
    start--;
  }
  return start;
}

const toRow = (item: Immutable<ValueItem>) => ({
  x: item.x ?? Number.NaN,
  y: item.value,
  value: item.originalValue,
  receiveTime: item.receiveTime,
});

/** Add full (preloaded) rows; returns the first row that changed. */
function appendFull(stream: Stream, items: Immutable<ValueItem[]>): number {
  const { points } = stream;
  if (items.length === 0) {
    return points.length;
  }
  const at = points.receiveUpperBound(items[0]!.receiveTime, 0, stream.fullLength);
  if (at === points.length) {
    // usual case: blocks load in time order and there are no current rows
    for (const item of items) {
      points.pushValue(item.x ?? Number.NaN, item.value, item.originalValue, item.receiveTime);
    }
    stream.fullLength += items.length;
    return at;
  }
  points.insert(at, items.map(toRow));
  stream.fullLength += items.length;
  // drop current rows the full rows now cover
  const last = points.receiveTime(stream.fullLength - 1);
  points.remove(stream.fullLength, points.receiveUpperBound(last, stream.fullLength));
  return at;
}

/**
 * Add current rows in receive order; returns the first row that changed. Current rows that full rows
 * cover are skipped. Without a range source, a backward seek plays older messages again; they are
 * inserted in order.
 */
function appendCurrent(stream: Stream, items: Immutable<ValueItem[]>): number {
  const { points } = stream;
  if (items.length === 0) {
    return points.length;
  }
  const lastFull = stream.fullLength > 0 ? points.receiveTime(stream.fullLength - 1) : undefined;
  // Usual case: messages arrive in order after everything stored; append without copies
  const prev = points.length > stream.fullLength ? points.receiveTime(points.length - 1) : lastFull;
  let prevSec = prev?.sec ?? -Infinity;
  let prevNsec = prev?.nsec ?? 0;
  let inOrder = lastFull == undefined || compare(items[0]!.receiveTime, lastFull) > 0;
  for (let i = 0; inOrder && i < items.length; i++) {
    const { sec, nsec } = items[i]!.receiveTime;
    inOrder = sec > prevSec || (sec === prevSec && nsec >= prevNsec);
    prevSec = sec;
    prevNsec = nsec;
  }
  if (inOrder) {
    const at = points.length;
    for (const item of items) {
      points.pushValue(item.x ?? Number.NaN, item.value, item.originalValue, item.receiveTime);
    }
    return at;
  }
  const rows = items
    .filter((item) => lastFull == undefined || compare(item.receiveTime, lastFull) > 0)
    .map(toRow);
  if (rows.length === 0) {
    return points.length;
  }
  // stable, so values of one message keep their order
  rows.sort((a, b) => compare(a.receiveTime, b.receiveTime));
  const at = points.receiveUpperBound(rows[0]!.receiveTime, stream.fullLength);
  if (at === points.length) {
    for (const row of rows) {
      points.push(row);
    }
    return at;
  }
  // Merge in one pass: stored rows first on equal receive times
  const tail: DataItem[] = [];
  for (let i = at; i < points.length; i++) {
    tail.push({
      x: points.x[i]!,
      y: points.y[i]!,
      value: points.value(i),
      receiveTime: points.receiveTime(i),
    });
  }
  points.truncate(at);
  let t = 0;
  for (const row of rows) {
    while (t < tail.length && compare(tail[t]!.receiveTime, row.receiveTime) <= 0) {
      points.push(tail[t++]!);
    }
    points.push(row);
  }
  for (; t < tail.length; t++) {
    points.push(tail[t]!);
  }
  return at;
}

export class CustomDatasetsBuilderImpl {
  #x: Stream = newStream();
  #seriesByKey = new Map<SeriesConfigKey, Series>();
  readonly #currentRowsPerStream: number;
  /** Live rows keep one message per this many seconds; 0 keeps all */
  #bucket = 0;

  public constructor(currentRowsPerStream = CURRENT_ROWS_PER_STREAM) {
    this.#currentRowsPerStream = currentRowsPerStream;
  }

  #currentRowsBudget(): number {
    return this.#currentRowsPerStream * (this.#seriesByKey.size + 1);
  }

  public updateData(actions: Immutable<UpdateDataAction[]>): void {
    // First current row each stream got in this batch. Thinning waits until every action of the
    // batch is in, so x and y values of the same messages are paired before anything is thinned.
    const appended = new Map<Stream, number>();
    for (const action of actions) {
      const changed = this.#applyAction(action);
      if (changed) {
        appended.set(
          changed.stream,
          Math.min(changed.from, appended.get(changed.stream) ?? Infinity),
        );
      }
    }
    if (appended.size > 0) {
      this.#thinCurrent(appended);
    }
  }

  public getViewportDatasets(viewport: Immutable<Viewport>): GetViewportDatasetsResult {
    const datasets: Dataset[] = [];
    const pathsWithMismatchedDataLengths = new Set<string>();
    for (const series of this.#seriesByKey.values()) {
      if (!series.config.enabled) {
        continue;
      }
      const dataset: Dataset = { ...buildDatasetStyle(series.config), data: [] };
      datasets[series.config.configIndex] = dataset;

      this.#pair(series);
      const { x: xs, y: ys, length } = series.points;
      if (series.mismatchRows.length > 0) {
        pathsWithMismatchedDataLengths.add(series.config.messagePath);
      }

      const xMin = viewport.bounds.x?.min;
      const xMax = viewport.bounds.x?.max;
      const yMin = viewport.bounds.y?.min;
      const yMax = viewport.bounds.y?.max;
      const bounds = {
        x: { min: xMin ?? 0, max: xMax ?? 0 },
        y: { min: yMin ?? 0, max: yMax ?? 0 },
      };
      if (xMin == undefined || xMax == undefined || yMin == undefined || yMax == undefined) {
        const data = dataBounds(xs, ys, length);
        bounds.x = { min: xMin ?? data.x.min, max: xMax ?? data.x.max };
        bounds.y = { min: yMin ?? data.y.min, max: yMax ?? data.y.max };
      }
      const view = { width: viewport.size.width, height: viewport.size.height, bounds };

      let indices: Iterable<number>;
      let count: number;
      if (length < Math.min(view.width, MAX_POINTS)) {
        indices = Array.from({ length }, (_, i) => i);
        count = length;
      } else {
        const picked =
          dataset.showLine === true
            ? downsamplePathColumns(xs, ys, 0, length, view, MAX_POINTS)
            : downsampleScatter(xs, ys, 0, length, view);
        indices = picked;
        count = picked.length;
      }
      // Hide points as a sign of downsampling; without lines they are all there is to see
      if (count < length && dataset.showLine === true) {
        dataset.pointRadius = 0;
      }
      for (const i of indices) {
        dataset.data.push({ x: xs[i]!, y: ys[i]!, value: series.points.value(i) });
      }
    }

    return { datasetsByConfigIndex: datasets, pathsWithMismatchedDataLengths };
  }

  public getCsvData(xRange?: Immutable<Bounds1D>): CsvDataset[] {
    const datasets: CsvDataset[] = [];
    for (const series of this.#seriesByKey.values()) {
      if (!series.config.enabled) {
        continue;
      }
      this.#pair(series);
      const { points } = series;
      const data: CsvDataset["data"] = [];
      for (let i = 0; i < points.length; i++) {
        const x = points.x[i]!;
        if (xRange && !(x >= xRange.min && x <= xRange.max)) {
          continue;
        }
        data.push({
          x,
          y: points.y[i]!,
          receiveTime: points.receiveTime(i),
          value: points.value(i),
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

  /**
   * Pair each y row with the x-axis message received last at or before it (the same message when
   * x and y share a topic), by the value's index within its message. Pairs are kept once the
   * x-axis has data at or after the row's receive time, so pans and zooms do not pair again.
   */
  #pair(series: Series): void {
    const { mismatchRows } = series;
    while (mismatchRows.length > 0 && mismatchRows.at(-1)! >= series.pairedUpTo) {
      mismatchRows.pop();
    }
    if (series.config.xParsed || series.pairedUpTo >= series.points.length) {
      return;
    }
    const { points } = series;
    const xPoints = this.#x.points;
    const xLength = xPoints.length;
    const from = series.pairedUpTo;
    let groupStart = from > 0 ? messageStart(points, from + 1, 0) : 0;
    let settled = true;
    // Rows and x-axis rows are both in receive order: walk them together
    let xEnd = from > 0 ? xPoints.receiveUpperBound(points.receiveTime(from)) : 0;
    let xStart = 0;
    for (let i = from; i < points.length; i++) {
      if (i === from || !points.sameReceive(i, i - 1)) {
        if (i > from) {
          groupStart = i;
        }
        // the x-axis message received last at or before this one
        const selected = xEnd;
        while (xEnd < xLength && points.compareReceive(i, xPoints, xEnd) >= 0) {
          xEnd++;
        }
        // find the selected x message's first row only when the selection changes
        if (i === from || xEnd !== selected) {
          xStart = xEnd > 0 ? messageStart(xPoints, xEnd, 0) : 0;
        }
      }
      let x = Number.NaN;
      const index = i - groupStart;
      if (xEnd > 0) {
        x = xStart + index < xEnd ? xPoints.y[xStart + index]! : Number.NaN;
        // At the message's last value: compare value counts with the paired x-axis message
        const groupEnds = i + 1 === points.length || !points.sameReceive(i + 1, i);
        if (groupEnds && index + 1 !== xEnd - xStart) {
          mismatchRows.push(i);
        }
      }
      points.x[i] = x;
      settled &&= xLength > 0 && points.compareReceive(i, xPoints, xLength - 1) <= 0;
      if (settled) {
        series.pairedUpTo = i + 1;
      }
    }
  }

  /** Rows of the x-axis changed from receive time `from` on: pair the y rows after it again. */
  #unpairFrom(from: Time | undefined): void {
    for (const series of this.#seriesByKey.values()) {
      const row = from == undefined ? 0 : series.points.receiveLowerBound(from);
      if (row < series.pairedUpTo) {
        series.pairedUpTo = row;
      }
    }
  }

  #streams(): Stream[] {
    return [this.#x, ...this.#seriesByKey.values()];
  }

  /**
   * Keep current rows within the budget by thinning them to one message per time bucket. The
   * bucket only grows (doubles), and later messages are kept at the same rate. Rows are paired
   * before thinning and keep their pairs, so thinning the x-axis does not move retained y values.
   */
  #thinCurrent(appended: ReadonlyMap<Stream, number>): void {
    const currentRows = () =>
      this.#streams().reduce((sum, s) => sum + s.points.length - s.fullLength, 0);
    let total = currentRows();
    if (this.#bucket === 0 && total <= this.#currentRowsBudget()) {
      return;
    }
    for (const series of this.#seriesByKey.values()) {
      this.#pair(series);
    }
    for (const [stream, from] of this.#bucket > 0 ? appended : []) {
      const floor = stream.fullLength;
      if (from > floor && from < stream.points.length) {
        // Only the newest message may break the bucket rule. Re-check from the message before
        // the one that was newest; it is first in its bucket, and older ones are settled.
        const prevStart = messageStart(stream.points, from, floor);
        this.#thin(
          stream,
          prevStart > floor ? messageStart(stream.points, prevStart, floor) : floor,
        );
      }
    }
    total = currentRows();
    if (total <= this.#currentRowsBudget()) {
      return;
    }
    // Past this bucket every stream is down to its first and newest message
    let maxSpan = 0;
    for (const { points, fullLength } of this.#streams()) {
      if (points.length > fullLength) {
        const span = points.receiveSeconds(points.length - 1) - points.receiveSeconds(fullLength);
        maxSpan = Math.max(maxSpan, span);
      }
    }
    while (total > this.#currentRowsBudget() && this.#bucket <= maxSpan) {
      if (this.#bucket === 0) {
        // Start at about half the message rate of the busiest stream
        let busiest = this.#x;
        for (const other of this.#streams()) {
          if (other.points.length - other.fullLength > busiest.points.length - busiest.fullLength) {
            busiest = other;
          }
        }
        const { points, fullLength } = busiest;
        const span = points.receiveSeconds(points.length - 1) - points.receiveSeconds(fullLength);
        this.#bucket = span > 0 ? (2 * span) / (points.length - fullLength) : maxSpan + 1;
      } else {
        this.#bucket *= 2;
      }
      for (const other of this.#streams()) {
        this.#thin(other, other.fullLength);
      }
      total = currentRows();
    }
  }

  /** Thin rows of `stream` from `start` on with the current bucket, keeping existing pairs */
  #thin(stream: Stream, start: number): void {
    if (stream === this.#x) {
      stream.points.thinByTime(start, this.#bucket);
      return;
    }
    const series = stream as Series;
    const before = series.points.length;
    // x is the paired or own x value: a missing one breaks the line like a missing y
    series.pairedUpTo = series.points.thinByTime(start, this.#bucket, {
      mark: series.pairedUpTo,
      gapsInX: true,
    });
    if (series.points.length < before) {
      // rows moved: a mismatch in the thinned range stays reported at its start
      const { mismatchRows } = series;
      let moved = false;
      while (mismatchRows.length > 0 && mismatchRows.at(-1)! >= start) {
        mismatchRows.pop();
        moved = true;
      }
      if (moved && start < series.pairedUpTo) {
        mismatchRows.push(start);
      }
    }
  }

  /** Rows of `stream` from `row` on changed */
  #rowsChanged(stream: Stream, row: number): void {
    if (stream === this.#x) {
      if (row < stream.points.length) {
        this.#unpairFrom(stream.points.receiveTime(row));
      }
      return;
    }
    const series = stream as Series;
    series.pairedUpTo = Math.min(series.pairedUpTo, row);
  }

  /** Returns the stream that got current rows, and the first of them */
  #applyAction(action: Immutable<UpdateDataAction>): { stream: Stream; from: number } | undefined {
    switch (action.type) {
      case "reset-current-x":
        this.#x.points.truncate(this.#x.fullLength);
        this.#unpairFrom(undefined);
        break;
      case "reset-full-x":
        this.#x.points.remove(0, this.#x.fullLength);
        this.#x.fullLength = 0;
        this.#unpairFrom(undefined);
        break;
      case "reset-current": {
        const series = this.#seriesByKey.get(action.series);
        if (series) {
          series.points.truncate(series.fullLength);
          series.pairedUpTo = Math.min(series.pairedUpTo, series.fullLength);
        }
        break;
      }
      case "reset-full": {
        const series = this.#seriesByKey.get(action.series);
        if (series) {
          series.points.remove(0, series.fullLength);
          series.fullLength = 0;
          series.pairedUpTo = 0;
        }
        break;
      }
      case "append-full-x": {
        const changed = appendFull(this.#x, action.items);
        this.#rowsChanged(this.#x, changed);
        break;
      }
      case "append-current-x": {
        const changed = appendCurrent(this.#x, action.items);
        this.#rowsChanged(this.#x, changed);
        return { stream: this.#x, from: changed };
      }
      case "append-full": {
        const series = this.#seriesByKey.get(action.series);
        if (series) {
          this.#rowsChanged(series, appendFull(series, action.items));
        }
        break;
      }
      case "append-current": {
        const series = this.#seriesByKey.get(action.series);
        if (series) {
          const changed = appendCurrent(series, action.items);
          this.#rowsChanged(series, changed);
          return { stream: series, from: changed };
        }
        break;
      }
      case "update-series-config": {
        const next = new Map<SeriesConfigKey, Series>();
        for (const config of action.seriesItems) {
          const series = this.#seriesByKey.get(config.key) ?? {
            ...newStream(),
            config,
            pairedUpTo: 0,
            mismatchRows: [],
          };
          if (Boolean(series.config.xParsed) !== Boolean(config.xParsed)) {
            series.pairedUpTo = 0;
          }
          series.config = config;
          next.set(config.key, series);
        }
        this.#seriesByKey = next;
        break;
      }
    }
    return undefined;
  }
}

/** Bounds of the finite values (NaN marks gaps and unpaired rows) */
function dataBounds(xs: Float64Array, ys: Float64Array, length: number) {
  let xMin = Number.MAX_VALUE;
  let xMax = -Number.MAX_VALUE;
  let yMin = Number.MAX_VALUE;
  let yMax = -Number.MAX_VALUE;
  for (let i = 0; i < length; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    if (!Number.isNaN(x)) {
      xMin = x < xMin ? x : xMin;
      xMax = x > xMax ? x : xMax;
    }
    if (!Number.isNaN(y)) {
      yMin = y < yMin ? y : yMin;
      yMax = y > yMax ? y : yMax;
    }
  }
  return { x: { min: xMin, max: xMax }, y: { min: yMin, max: yMax } };
}
