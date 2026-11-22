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
  public readonly columns: Record<K, ColumnArray>;
  #stride = 1;
  /** Rows received since the last row kept at the stride. */
  #sinceKept = 0;
  /** Whether the last row is only kept because it is the newest. */
  #tailIsExtra = false;

  public constructor(
    private readonly spec: Record<K, Column>,
    private readonly limit: number,
  ) {
    this.columns = this.#allocate(16);
  }

  public clear(): void {
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
      return this.length - 1;
    }
    if (this.length === this.columns[this.#keys()[0]!].length) {
      const next = this.#allocate(this.length * 2);
      for (const key of this.#keys()) {
        next[key].set(this.columns[key]);
      }
      Object.assign(this.columns, next);
    }
    return this.length++;
  }

  #halve(): void {
    // Keep rows 0, 2, 4, ...; the next kept row follows a full new stride after the last one.
    const kept = Math.ceil(this.length / 2);
    for (const key of this.#keys()) {
      const column = this.columns[key];
      for (let i = 1; i < kept; i++) {
        column[i] = column[2 * i]!;
      }
    }
    this.#sinceKept += this.length % 2 === 0 ? this.#stride : 0;
    this.#stride *= 2;
    this.length = kept;
  }

  #keys(): K[] {
    return Object.keys(this.spec) as K[];
  }

  #allocate(capacity: number): Record<K, ColumnArray> {
    const result = {} as Record<K, ColumnArray>;
    for (const key of this.#keys()) {
      result[key] = new this.spec[key](capacity);
    }
    return result;
  }
}

/** Index of the last row with `time[i] <= t`, or -1. Times must be sorted. */
export function lastIndexAtOrBefore(time: ArrayLike<number>, length: number, t: number): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (time[mid]! <= t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo - 1;
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

const mercatorX = (lon: number) => (lon + 180) / 360;
const mercatorY = (lat: number) => {
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

/** Area to draw, in degrees. */
export type Viewport = { west: number; south: number; east: number; north: number };

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
  // MapLibre's world is 512 px wide at zoom 0.
  let minDistance = options.minPixels / (512 * 2 ** options.zoom);
  for (;;) {
    const indices: number[] = [];
    const runs: number[] = [];
    let gap = true;
    let lastX = 0;
    let lastY = 0;
    let nearPrevious = false;
    let near = n > 0 && inView(0);
    for (let i = 0; i < n; i++) {
      const nearNext = i + 1 < n && inView(i + 1);
      if (!near && !nearPrevious && !nearNext) {
        gap = true;
      } else {
        const x = mercatorX(lon[i]!);
        const y = mercatorY(lat[i]!);
        // The ends of each run are always kept, so the track meets the viewport edge.
        if (gap || i === n - 1 || !nearNext || Math.hypot(x - lastX, y - lastY) >= minDistance) {
          if (gap) {
            runs.push(indices.length);
            gap = false;
          }
          indices.push(i);
          lastX = x;
          lastY = y;
        }
      }
      nearPrevious = near;
      near = nearNext;
    }
    if (indices.length <= options.budget || minDistance > 1) {
      return { indices: Uint32Array.from(indices), runs };
    }
    // Kept points shrink roughly in proportion to the spacing; overshoot a little.
    minDistance *= Math.max(1.25, (indices.length / options.budget) * 1.1);
  }
}

/** The fix between the kept neighbors of `kept[k]` that is closest to `at`, at full resolution. */
export function nearestFix(store: TrackStore, kept: Uint32Array, k: number, at: LngLat): number {
  // Capped: across a part outside the viewport the neighbors can be far apart, and far away.
  const from = Math.max(kept[k]! - 10_000, k > 0 ? kept[k - 1]! + 1 : 0);
  const to = Math.min(kept[k]! + 10_000, k + 1 < kept.length ? kept[k + 1]! - 1 : store.length - 1);
  const x = mercatorX(at[0]);
  const y = mercatorY(at[1]);
  const { lon, lat } = store.columns;
  let best = kept[k]!;
  let bestDistance = Infinity;
  for (let i = from; i <= to; i++) {
    const d = Math.hypot(mercatorX(lon[i]!) - x, mercatorY(lat[i]!) - y);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}
