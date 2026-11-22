// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Immutable, Time } from "@lichtblick/suite";
import { Point } from "@lichtblick/suite-base/components/Chart/datasets";

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
export class PointColumns {
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

  /** Receive time in seconds; loses sub-microsecond precision, for bucketing only */
  public receiveSeconds(i: number): number {
    return this.#receiveSec[i]! + this.#receiveNsec[i]! / 1e9;
  }

  /** Whether rows `i` and `j` were received at the same time, i.e. come from the same message */
  public sameReceive(i: number, j: number): boolean {
    return (
      this.#receiveSec[i] === this.#receiveSec[j] && this.#receiveNsec[i] === this.#receiveNsec[j]
    );
  }

  /** First row in [from, to) received at or after `time`, or `to`. Rows must be in receive order. */
  public receiveLowerBound(time: Immutable<Time>, from = 0, to = this.length): number {
    return this.#receiveBound(time, from, to, (nsec) => nsec < time.nsec);
  }

  /** First row in [from, to) received after `time`, or `to`. Rows must be in receive order. */
  public receiveUpperBound(time: Immutable<Time>, from = 0, to = this.length): number {
    return this.#receiveBound(time, from, to, (nsec) => nsec <= time.nsec);
  }

  #receiveBound(
    time: Immutable<Time>,
    from: number,
    to: number,
    sameSecBefore: (nsec: number) => boolean,
  ): number {
    let lo = from;
    let hi = to;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const sec = this.#receiveSec[mid]!;
      if (sec < time.sec || (sec === time.sec && sameSecBefore(this.#receiveNsec[mid]!))) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /**
   * Thin rows [start, length), which must be in receive order, to one message per `bucket` seconds
   * of receive time: a message stays if it is the first in its bucket, and the newest message
   * always stays. The decision only depends on receive times, so streams read from the same
   * messages keep the same messages. Returns the number of rows removed.
   */
  public thinByTime(start: number, bucket: number): number {
    const end = this.length;
    let write = start;
    let lastBucket = Number.NaN;
    for (let read = start; read < end; ) {
      let groupEnd = read + 1;
      while (groupEnd < end && this.sameReceive(groupEnd, read)) {
        groupEnd++;
      }
      const b = Math.floor(this.receiveSeconds(read) / bucket);
      if (b !== lastBucket || groupEnd === end) {
        for (let i = read; i < groupEnd; i++) {
          this.#moveRow(i, write++);
        }
      }
      lastBucket = b;
      read = groupEnd;
    }
    this.length = write;
    if (this.#values && this.#values.length > write) {
      this.#values.length = write;
    }
    return end - write;
  }

  public headerStamp(i: number): Time | undefined {
    const sec = this.#stampSec[i]!;
    return Number.isNaN(sec) ? undefined : { sec, nsec: this.#stampNsec[i]! };
  }

  public push(item: Immutable<DataItem>): void {
    this.#reserve(this.length + 1);
    this.set(this.length++, item);
  }

  /** Overwrite row `i` */
  public set(i: number, item: Immutable<DataItem>): void {
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

  /**
   * Halve rows [start, length) by dropping every other row; the first and the last row stay.
   * Returns the number of rows removed.
   */
  public halve(start: number): number {
    const end = this.length;
    if (end - start <= 2) {
      return 0;
    }
    let write = start + 1;
    for (let read = start + 2; read < end - 1; read += 2) {
      this.#moveRow(read, write++);
    }
    this.#moveRow(end - 1, write++);
    this.length = write;
    if (this.#values && this.#values.length > write) {
      this.#values.length = write;
    }
    return end - write;
  }

  #moveRow(from: number, to: number): void {
    for (const col of this.#columns()) {
      col[to] = col[from]!;
    }
    if (this.#values) {
      this.#values[to] = this.#values[from];
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
export function upperBound(xs: Float64Array, from: number, to: number, value: number): number {
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
export function lowerBound(xs: Float64Array, from: number, to: number, value: number): number {
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

/** Point view over columns for the shared downsamplers; the yielded object is reused. */
export function* iteratePoints(
  xs: Float64Array,
  ys: Float64Array,
  start: number,
  end: number,
): Generator<Point> {
  const point: Point = { index: 0, x: 0, y: 0 };
  for (let i = start; i < end; i++) {
    point.index = i;
    point.x = xs[i]!;
    point.y = ys[i]!;
    yield point;
  }
}
