// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { toSec } from "@foxglove/rostime";

import type { MessageEvent } from "@lichtblick/suite";

import { LngLat } from "./geo";
import { NavSatFixMsg } from "./types";

type Column =
  | Float64ArrayConstructor
  | Float32ArrayConstructor
  | Uint32ArrayConstructor
  | Uint16ArrayConstructor
  | Int8ArrayConstructor;
type ColumnArray = InstanceType<Column>;

/**
 * Columns of numbers that grow by doubling. Past `limit` rows every other row is dropped and later
 * rows are kept at the same thinned rate, so a long series loses time resolution evenly instead of
 * losing its start. The newest row is always kept.
 */
export class ColumnStore<K extends string> {
  public length = 0;
  /** Changes when existing rows move or go away (clear, thinning); appending keeps it. */
  public version = 0;
  /** Counts in-place replacements of the newest row (while thinned), which keep `version`. */
  public tailReplacements = 0;
  public readonly columns: Record<K, ColumnArray>;
  readonly #keys: K[];
  #stride = 1;
  /** Rows received since the last row kept at the stride. */
  #sinceKept = 0;
  /** Whether the last row is only kept because it is the newest. */
  #tailIsExtra = false;

  public constructor(
    private readonly spec: Record<K, Column>,
    private readonly limit: number,
  ) {
    this.#keys = Object.keys(spec) as K[];
    this.columns = this.#allocate(16);
  }

  public clear(): void {
    this.version++;
    this.length = 0;
    this.#stride = 1;
    this.#sinceKept = 0;
    this.#tailIsExtra = false;
  }

  /** Row index to write the next row to (a row is replaced while thinned). */
  protected nextRow(): number {
    if (!this.#tailIsExtra && this.length >= this.limit) {
      this.#halve();
    }
    this.#sinceKept++;
    const keep = this.#sinceKept >= this.#stride;
    if (keep) {
      this.#sinceKept = 0;
    }
    const replaceTail = this.#tailIsExtra;
    this.#tailIsExtra = !keep;
    if (replaceTail) {
      this.tailReplacements++;
      return this.length - 1;
    }
    if (this.length === this.columns[this.#keys[0]!].length) {
      const next = this.#allocate(this.length * 2);
      for (const key of this.#keys) {
        next[key].set(this.columns[key]);
      }
      Object.assign(this.columns, next);
    }
    return this.length++;
  }

  #halve(): void {
    this.version++;
    // Keep rows 0, 2, 4, ...; the next kept row follows a full new stride after the last one.
    const kept = Math.ceil(this.length / 2);
    for (const key of this.#keys) {
      const column = this.columns[key];
      for (let i = 1; i < kept; i++) {
        column[i] = column[2 * i]!;
      }
    }
    this.#sinceKept += this.length % 2 === 0 ? this.#stride : 0;
    this.#stride *= 2;
    this.length = kept;
  }

  #allocate(capacity: number): Record<K, ColumnArray> {
    const result = {} as Record<K, ColumnArray>;
    for (const key of this.#keys) {
      result[key] = new this.spec[key](capacity);
    }
    return result;
  }
}

/** Fixes kept per topic before the track is thinned (~40 bytes each). */
export const TRACK_LIMIT = 1_000_000;
const NO_STATUS = -128;

/**
 * The fixes of one topic, in columns. A message object per fix costs ~10x the memory, and a long
 * recording has millions of fixes.
 */
export class TrackStore extends ColumnStore<
  "time" | "sec" | "nsec" | "lon" | "lat" | "alt" | "status" | "service"
> {
  /** Schema of the latest fix, for messages rebuilt from the columns. */
  public schemaName = "";

  public constructor(
    public readonly topic: string,
    limit = TRACK_LIMIT,
  ) {
    super(
      {
        time: Float64Array,
        sec: Uint32Array,
        nsec: Uint32Array,
        lon: Float64Array,
        lat: Float64Array,
        alt: Float32Array,
        status: Int8Array,
        service: Uint16Array,
      },
      limit,
    );
  }

  public push(event: MessageEvent<NavSatFixMsg>): void {
    const { latitude, longitude, altitude, status } = event.message;
    const c = this.columns;
    const i = this.nextRow();
    this.schemaName = event.schemaName;
    c.time[i] = toSec(event.receiveTime);
    c.sec[i] = event.receiveTime.sec;
    c.nsec[i] = event.receiveTime.nsec;
    c.lon[i] = longitude;
    c.lat[i] = latitude;
    c.alt[i] = altitude ?? NaN;
    c.status[i] = status?.status ?? NO_STATUS;
    c.service[i] = status?.service ?? 0;
  }

  public lngLat(i: number): LngLat {
    return [this.columns.lon[i]!, this.columns.lat[i]!];
  }

  /** The fix at `i` as a message, for popups and seeking. */
  public message(i: number): MessageEvent<NavSatFixMsg> {
    const c = this.columns;
    const alt = c.alt[i]!;
    const status = c.status[i]!;
    return {
      topic: this.topic,
      schemaName: this.schemaName,
      receiveTime: { sec: c.sec[i]!, nsec: c.nsec[i]! },
      sizeInBytes: 0,
      message: {
        latitude: c.lat[i]!,
        longitude: c.lon[i]!,
        altitude: isNaN(alt) ? undefined : alt,
        status: status === NO_STATUS ? undefined : { status, service: c.service[i]! },
      },
    };
  }
}

/** Values over time (seconds), e.g. of a message path that colors a track. */
export class SampleStore extends ColumnStore<"time" | "value"> {
  public constructor(limit = TRACK_LIMIT) {
    super({ time: Float64Array, value: Float64Array }, limit);
  }

  public push(time: number, value: number): void {
    const i = this.nextRow();
    this.columns.time[i] = time;
    this.columns.value[i] = value;
  }
}

/** Area to draw, in degrees. */
export type Viewport = { west: number; south: number; east: number; north: number };

/** What the track was thinned for: a zoom, and the viewport padded by its size on each side. */
export type ThinView = { zoom: number; viewport?: Viewport };

/** The view to thin for, given the visible bounds at `zoom` (no culling when it would wrap). */
export function thinViewFor(zoom: number, bounds: Viewport): ThinView {
  const width = bounds.east - bounds.west;
  const height = bounds.north - bounds.south;
  const viewport = {
    west: bounds.west - width,
    east: bounds.east + width,
    south: bounds.south - height,
    north: bounds.north + height,
  };
  // No culling across the antimeridian or when the whole world is in view: the budget still
  // bounds the track, and wrapped bounds would need two boxes.
  const wraps = viewport.west < -180 || viewport.east > 180;
  return { zoom, viewport: wraps ? undefined : viewport };
}

/**
 * Whether a track thinned for `previous` still serves the visible `bounds` at `zoom`: the view
 * stayed inside the padding and the spacing is still about right. Following a moving fix pans the
 * map on every fix, and re-thinning a long track each time costs tens of milliseconds.
 */
export function thinViewCovers(previous: ThinView, zoom: number, bounds: Viewport): boolean {
  const v = previous.viewport;
  return (
    Math.abs(zoom - previous.zoom) < 0.25 &&
    (v == undefined
      ? thinViewFor(zoom, bounds).viewport == undefined
      : bounds.west >= v.west &&
        bounds.east <= v.east &&
        bounds.south >= v.south &&
        bounds.north <= v.north)
  );
}

/**
 * Indices of the fixes to draw: inside the viewport (and one beyond, so lines leave it), at
 * least `minPixels` apart at `zoom`, and at most about `budget` of them (the spacing grows until
 * they fit). `runs` holds the positions in `indices` where a new line starts, after a part of
 * the track outside the viewport.
 */
export function thinTrack(
  store: TrackStore,
  options: { zoom: number; minPixels: number; budget: number; viewport?: Viewport },
): { indices: Uint32Array; runs: number[] } {
  const { lon, lat } = store.columns;
  const n = store.length;
  const v = options.viewport;
  const inView = (i: number) =>
    v == undefined ||
    (lon[i]! >= v.west && lon[i]! <= v.east && lat[i]! >= v.south && lat[i]! <= v.north);
  // Whether the segment from fix i to i + 1 may cross the viewport (its bounding box does), so a
  // sparse line through the view is kept even with both ends outside it.
  const segmentInView = (i: number) =>
    v == undefined ||
    (Math.min(lon[i]!, lon[i + 1]!) <= v.east &&
      Math.max(lon[i]!, lon[i + 1]!) >= v.west &&
      Math.min(lat[i]!, lat[i + 1]!) <= v.north &&
      Math.max(lat[i]!, lat[i + 1]!) >= v.south);
  // MapLibre's world is 512 px wide at zoom 0.
  // Spacing is for the zoom at the map center; a tilted map is magnified near the camera, where
  // points (drawn at a fixed pixel size) can show the spacing. Lines are thinned at 1 px.
  // In degrees of longitude. Locally a degree of latitude is 1/cos(lat) as long on a Mercator map,
  // so distances need no projection (no log or sin per fix).
  let minDistance = (options.minPixels / (512 * 2 ** options.zoom)) * 360;
  let previousCount = Infinity;
  for (;;) {
    const minSquared = minDistance * minDistance;
    const indices: number[] = [];
    const runs: number[] = [];
    let gap = true;
    let lastLon = 0;
    let lastLat = 0;
    let latScale = 1;
    let segmentBefore = false;
    for (let i = 0; i < n; i++) {
      const segmentAfter = i + 1 < n && segmentInView(i);
      if (!segmentBefore && !segmentAfter && !inView(i)) {
        gap = true;
      } else {
        const x = lon[i]!;
        const y = lat[i]!;
        const dx = x - lastLon;
        const dy = (y - lastLat) * latScale;
        // The ends of each run are always kept, so the track meets the viewport edge.
        if (gap || !segmentAfter || dx * dx + dy * dy >= minSquared) {
          if (gap) {
            runs.push(indices.length);
            gap = false;
          }
          indices.push(i);
          lastLon = x;
          lastLat = y;
          latScale = 1 / Math.cos((Math.max(-85, Math.min(85, y)) * Math.PI) / 180);
        }
      }
      segmentBefore = segmentAfter;
    }
    if (indices.length <= options.budget) {
      return { indices: Uint32Array.from(indices), runs };
    }
    // Run ends are kept at any spacing: when they alone exceed the budget (a track zigzagging
    // across the viewport edge), take an even sample instead.
    if (minDistance > 360 || indices.length > previousCount * 0.9) {
      return sampleEvenly(indices, runs, options.budget);
    }
    previousCount = indices.length;
    // Kept points shrink roughly in proportion to the spacing; overshoot a little.
    minDistance *= Math.max(1.25, (indices.length / options.budget) * 1.1);
  }
}

/**
 * At most `budget` of `indices` that still draw every run as its shape: each run keeps its two
 * ends and its middle point (so a bend into the viewport between two ends outside it survives),
 * and the rest of the budget goes to the other points inside runs, evenly. With more runs than
 * fit that way, an even selection of runs is drawn, each as its ends and middle.
 */
function sampleEvenly(
  indices: readonly number[],
  runs: readonly number[],
  budget: number,
): { indices: Uint32Array; runs: number[] } {
  const runEnd = (r: number) => (runs[r + 1] ?? indices.length) - 1;
  const shapeCost = (r: number) => Math.min(3, runEnd(r) - runs[r]! + 1);
  let shapes = 0;
  for (let r = 0; r < runs.length; r++) {
    shapes += shapeCost(r);
  }
  // Every runStride-th run, sized so their shapes fit.
  let runStride = Math.max(1, Math.ceil(shapes / budget));
  const chosenCost = () => {
    let cost = 0;
    for (let r = 0; r < runs.length; r += runStride) {
      cost += shapeCost(r);
    }
    return cost;
  };
  let cost = chosenCost();
  while (cost > budget) {
    runStride++;
    cost = chosenCost();
  }
  // Points beyond the shapes, only when every run is drawn.
  const others = runStride === 1 ? indices.length - shapes : 0;
  const sampleOthers = others > 0 && budget > cost;
  const otherStride = sampleOthers ? Math.ceil(others / (budget - cost)) : 1;
  const sampled: number[] = [];
  const sampledRuns: number[] = [];
  let othersSeen = 0;
  for (let r = 0; r < runs.length; r += runStride) {
    const start = runs[r]!;
    const end = runEnd(r);
    const middle = (start + end) >> 1;
    sampledRuns.push(sampled.length);
    for (let j = start; j <= end; j++) {
      const shape = j === start || j === end || j === middle;
      if (shape || (sampleOthers && othersSeen++ % otherStride === 0)) {
        sampled.push(indices[j]!);
      }
    }
  }
  return { indices: Uint32Array.from(sampled), runs: sampledRuns };
}

/**
 * The fix between the kept neighbors of `kept[k]` that is closest to `at`, at full resolution,
 * among the first `length` rows. With `radius` (degrees of latitude), also the runs of fixes that
 * close to `at`, as `[first, last]` in store order.
 */
export function nearestFix(
  store: TrackStore,
  kept: Uint32Array,
  k: number,
  at: LngLat,
  length = store.length,
  radius = 0,
): { nearest: number; within: [number, number][] } {
  // Capped: across a part outside the viewport the neighbors can be far apart, and far away.
  const from = Math.max(kept[k]! - 10_000, k > 0 ? kept[k - 1]! + 1 : 0);
  // `kept` may be from before the store last changed: stay inside it.
  const to = Math.min(
    kept[k]! + 10_000,
    k + 1 < kept.length ? kept[k + 1]! - 1 : Infinity,
    Math.min(length, store.length) - 1,
  );
  // Web Mercator distance near `at`, squared and in degrees of latitude: flat-earth, exact at the
  // cursor's few pixels and with no projection per fix.
  const { lon, lat } = store.columns;
  const scale = Math.cos((at[1] * Math.PI) / 180);
  const distance = (i: number) => {
    // Periodic in longitude: the cursor can be on another copy of the world (lng beyond ±180).
    const dLon = lon[i]! - at[0];
    const dx = (dLon - 360 * Math.round(dLon / 360)) * scale;
    const dy = lat[i]! - at[1];
    return dx * dx + dy * dy;
  };
  const limit = radius * radius;
  let best = Math.min(kept[k]!, store.length - 1);
  let bestDistance = Infinity;
  const within: [number, number][] = [];
  for (let i = from; i <= to; i++) {
    const d = distance(i);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
    if (d <= limit) {
      const run = within.at(-1);
      if (run?.[1] === i - 1) {
        run[1] = i;
      } else {
        within.push([i, i]);
      }
    }
  }
  return { nearest: best, within };
}
