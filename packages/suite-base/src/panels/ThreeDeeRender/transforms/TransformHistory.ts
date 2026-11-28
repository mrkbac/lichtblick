// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Transform } from "./Transform";
import { Time } from "./time";

// [time, receiveTime, x, y, z, qx, qy, qz, qw] per sample
const STRIDE = 9;
const TIME = 0;
const RECEIVE = 1;
const VALUES = 2;
const INITIAL_CAPACITY = 4;
/**
 * Capacity relative to the sample count when growing or shrinking. A pruned window compacts once
 * per (capacity - size) inserts, copying the window: 1.25 copies 4 samples per insert and holds 25%
 * spare (1.5 measured no faster with 50% spare, 1.125 ~20% slower inserts).
 */
const GROWTH = 1.25;
/** Compact the view instead of growing while the samples fill at most this share of the buffer */
const COMPACT_BELOW = 1 / GROWTH;

/**
 * Time-sorted transform samples of one frame, packed into a single Float64Array: 72 bytes per
 * sample instead of a Transform object (three arrays and a matrix) plus a map entry. Times are
 * stored in nanoseconds relative to the first sample, which keeps them exact as doubles for
 * recordings up to ~104 days. Receive times (the playback clock, which header stamps need not
 * share) are relative to the first receive time the same way.
 */
export class TransformHistory {
  #base: Time = 0n;
  #receiveBase: Time | undefined;
  /** Backing storage; #data is a view of it that starts after samples removed from the front */
  #buffer = new Float64Array(STRIDE * INITIAL_CAPACITY);
  #data = this.#buffer;
  #size = 0;
  /** Keep one appended sample per this many; the newest one is always kept */
  #keepEvery = 1;
  /** Samples older than this (ns before the newest) keep one per #thinSpacing ns (see #compact) */
  #thinAfter = Infinity;
  #thinSpacing = 0;
  /** Relative time up to which samples were already thinned, so compaction copies them as they are */
  #thinnedUntil = -Infinity;
  /** Relative time the newest sample must reach before removeOlderThan has anything to remove */
  #pruneAt = -Infinity;
  /** Appended samples merged into the newest one since it was appended */
  #headInputs = 0;

  public size(): number {
    return this.#size;
  }

  /** Samples the backing storage holds */
  public capacity(): number {
    return this.#buffer.length / STRIDE;
  }

  public setKeepEvery(keepEvery: number): void {
    this.#keepEvery = keepEvery;
  }

  /**
   * Thin by age: samples more than `fullRateDuration` ns older than the newest keep one per
   * `spacing` ns interval, plus both ends of runs of equal values. Applied while compacting, which
   * copies the samples anyway.
   */
  public setAgeThinning(fullRateDuration: number, spacing: number): void {
    this.#thinAfter = fullRateDuration;
    this.#thinSpacing = spacing;
  }

  public timeAt(index: number): Time {
    return this.#base + BigInt(this.#data[index * STRIDE]!);
  }

  /** Writes the sample at `index` into `out` */
  public transformAt(index: number, out: Transform): Transform {
    const d = this.#data;
    const o = index * STRIDE + VALUES;
    tempPosition[0] = d[o]!;
    tempPosition[1] = d[o + 1]!;
    tempPosition[2] = d[o + 2]!;
    tempRotation[0] = d[o + 3]!;
    tempRotation[1] = d[o + 4]!;
    tempRotation[2] = d[o + 5]!;
    tempRotation[3] = d[o + 6]!;
    return out.setPositionRotation(tempPosition, tempRotation);
  }

  /**
   * Binary search contract: the index of `time`, or the bitwise complement of the
   * index it would be inserted at.
   */
  public binarySearch(time: Time, size = this.#size): number {
    if (size === 0) {
      return ~0;
    }
    const target = Number(time - this.#base);
    const d = this.#data;
    // Fast path: lookups at or after the newest sample (the current time of a live source)
    const newest = d[(size - 1) * STRIDE]!;
    if (target >= newest) {
      return target === newest ? size - 1 : ~size;
    }
    let low = 0;
    let high = size - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const midTime = d[mid * STRIDE]!;
      if (midTime < target) {
        low = mid + 1;
      } else if (midTime > target) {
        high = mid - 1;
      } else {
        return mid;
      }
    }
    return ~low;
  }

  /**
   * Number of leading samples received at or before `receivedUntil`. Receive times are kept
   * non-decreasing in stamp order (see #keepReceiveOrder), so this is a binary search.
   */
  public receivedCount(receivedUntil: Time): number {
    if (this.#receiveBase == undefined) {
      return this.#size;
    }
    return this.#countAtMost(RECEIVE, Number(receivedUntil - this.#receiveBase));
  }

  /** Number of leading samples whose `column` value is at most `value` (it is non-decreasing) */
  #countAtMost(column: number, value: number): number {
    const d = this.#data;
    let low = 0;
    let high = this.#size;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (d[mid * STRIDE + column]! <= value) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  /**
   * Inserts a sample in time order, replacing one with the same time. `receiveTime` defaults to
   * "always received", for transforms that do not come from a message.
   */
  public set(time: Time, transform: Transform, receiveTime?: Time): void {
    if (this.#size === 0) {
      this.#base = time;
      // The prune deadline and thinned prefix are relative to the old base
      this.#pruneAt = -Infinity;
      this.#thinnedUntil = -Infinity;
    }
    if (receiveTime != undefined) {
      this.#receiveBase ??= receiveTime;
    }
    let receive = receiveTime == undefined ? -Infinity : Number(receiveTime - this.#receiveBase!);
    if ((this.#size + 1) * STRIDE > this.#data.length) {
      this.#makeRoom();
    }
    const lastIndex = this.#size - 1;
    const relativeTime = Number(time - this.#base);
    // Fast path: samples almost always arrive in time order
    let index =
      lastIndex < 0 || relativeTime > this.#data[lastIndex * STRIDE]!
        ? ~this.#size
        : this.binarySearch(time);
    if (index !== ~this.#size) {
      // Not appended: it may have landed before the window start, so check pruning again
      this.#pruneAt = -Infinity;
    }
    if (index < 0) {
      index = ~index;
      if (index === this.#size && this.#size >= 2) {
        // Overwrite the newest sample instead of appending when the last two samples and this one
        // are equal (interpolation over the run gives the same result), or to keep only one in
        // #keepEvery samples. The first sample and the newest one always stay.
        if (this.#extendsRun(transform) || this.#headInputs < this.#keepEvery) {
          this.#headInputs++;
          this.#write(lastIndex, relativeTime, receive, transform);
          this.#keepReceiveOrder(lastIndex);
          return;
        }
      }
      this.#headInputs = 1;
      this.#insertGap(index);
    } else if (this.#equals(index, transform)) {
      // The same transform received again: it was visible since it first arrived
      receive = Math.min(receive, this.#data[index * STRIDE + 1]!);
    }
    this.#write(index, relativeTime, receive, transform);
    this.#keepReceiveOrder(index);
  }

  /**
   * Keeps receive times non-decreasing in stamp order. A sample whose stamp sorts before samples
   * that were received earlier holds those back until it is received too, so lookups never see a
   * transform from after the playback time; out-of-order arrival only delays visibility a little.
   */
  #keepReceiveOrder(index: number): void {
    const d = this.#data;
    const at = index * STRIDE + 1;
    if (index > 0 && d[at]! < d[at - STRIDE]!) {
      d[at] = d[at - STRIDE]!;
    }
    const receive = d[at]!;
    for (let j = at + STRIDE; j < this.#size * STRIDE && d[j]! < receive; j += STRIDE) {
      d[j] = receive;
    }
  }

  /** Removes the sample with exactly this time; returns whether one existed */
  public remove(time: Time): boolean {
    const index = this.binarySearch(time);
    if (index < 0) {
      return false;
    }
    this.#data.copyWithin(index * STRIDE, (index + 1) * STRIDE, this.#size * STRIDE);
    this.#size--;
    // The prune deadline came from samples that may be gone
    this.#pruneAt = -Infinity;
    this.#shrink();
    return true;
  }

  /** Removes the first `count` samples */
  public removeFirst(count: number): void {
    const n = Math.min(count, this.#size);
    if (n <= 0) {
      return;
    }
    // O(1): move the view forward; #insertGap compacts it when it reaches the end of the buffer
    this.#data = this.#data.subarray(n * STRIDE);
    this.#size -= n;
    this.#shrink();
  }

  /**
   * Removes samples older than `duration` ns before the newest one, keeping the newest sample at or
   * before the window start so lookups inside the window still interpolate from it.
   */
  public removeOlderThan(duration: number): void {
    const d = this.#data;
    const newest = d[(this.#size - 1) * STRIDE]!;
    // Skip without touching the (cold) front of the buffer until a removal can be due
    if (newest < this.#pruneAt) {
      return;
    }
    const start = newest - duration;
    // Batch removals (each one allocates a view): wait until 1/64 of the samples are past the start
    const batch = Math.max(1, this.#size >> 6);
    if (batch >= this.#size) {
      return;
    }
    if (d[batch * STRIDE]! > start) {
      this.#pruneAt = d[batch * STRIDE]! + duration;
      return;
    }
    let n = batch;
    while (n + 1 < this.#size && d[(n + 1) * STRIDE]! <= start) {
      n++;
    }
    this.removeFirst(n);
  }

  public clear(): void {
    this.#size = 0;
    this.#receiveBase = undefined;
    this.#pruneAt = -Infinity;
    this.#thinnedUntil = -Infinity;
    this.#buffer = new Float64Array(STRIDE * INITIAL_CAPACITY);
    this.#data = this.#buffer;
  }

  /**
   * Puts the samples of `earlier` in front, for history read backwards (see TransformTree.prepend):
   * one copy when they are all stamped before this history's first sample, else one by one.
   */
  public prepend(earlier: TransformHistory): void {
    const added = earlier.#size;
    if (added === 0) {
      return;
    }
    if (this.#size > 0 && earlier.timeAt(added - 1) >= this.timeAt(0)) {
      // Stamps overlap (a publisher's clock behind its receive times): insert them one by one
      const transform = Transform.Identity();
      for (let i = 0; i < added; i++) {
        const receive = earlier.#data[i * STRIDE + RECEIVE]!;
        const receiveTime =
          receive === -Infinity ? undefined : earlier.#receiveBase! + BigInt(receive);
        this.set(earlier.timeAt(i), earlier.transformAt(i, transform), receiveTime);
      }
      return;
    }
    const size = this.#size;
    const receiveBase = earlier.#receiveBase ?? this.#receiveBase;
    const timeShift = Number(this.#base - earlier.#base);
    const receiveShift =
      this.#receiveBase == undefined ? 0 : Number(this.#receiveBase - receiveBase!);
    const data = new Float64Array(Math.ceil((added + size) * GROWTH) * STRIDE);
    data.set(earlier.#data.subarray(0, added * STRIDE));
    data.set(this.#data.subarray(0, size * STRIDE), added * STRIDE);
    for (let o = added * STRIDE; o < (added + size) * STRIDE; o += STRIDE) {
      data[o + TIME] = data[o + TIME]! + timeShift;
      data[o + RECEIVE] = data[o + RECEIVE]! + receiveShift;
    }
    this.#buffer = data;
    this.#data = data;
    this.#size = added + size;
    this.#base = earlier.#base;
    this.#receiveBase = receiveBase;
    this.#pruneAt = -Infinity;
    this.#thinnedUntil = -Infinity;
    if (size > 0) {
      this.#keepReceiveOrder(added);
    }
  }

  /**
   * Halves the sample count by dropping every other sample, always keeping the first and last.
   * Returns the number of samples removed.
   */
  public decimate(): number {
    const size = this.#size;
    if (size <= 2) {
      return 0;
    }
    const d = this.#data;
    let write = 1;
    for (let read = 2; read < size - 1; read += 2, write++) {
      d.copyWithin(write * STRIDE, read * STRIDE, (read + 1) * STRIDE);
    }
    d.copyWithin(write * STRIDE, (size - 1) * STRIDE, size * STRIDE);
    this.#size = write + 1;
    this.#shrink();
    return size - this.#size;
  }

  #extendsRun(transform: Transform): boolean {
    const size = this.#size;
    return (
      size >= 2 &&
      this.#equals(size - 1, transform) &&
      this.#sameValues((size - 1) * STRIDE, (size - 2) * STRIDE)
    );
  }

  #equals(index: number, transform: Transform): boolean {
    const d = this.#data;
    const o = index * STRIDE + VALUES;
    const p = transform.position();
    const q = transform.rotation();
    return (
      d[o] === p[0] &&
      d[o + 1] === p[1] &&
      d[o + 2] === p[2] &&
      d[o + 3] === q[0] &&
      d[o + 4] === q[1] &&
      d[o + 5] === q[2] &&
      d[o + 6] === q[3]
    );
  }

  #sameValues(a: number, b: number): boolean {
    const d = this.#data;
    for (let i = VALUES; i < STRIDE; i++) {
      if (d[a + i] !== d[b + i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * Releases storage once less than half of it is used (after thinning or pruning), so retained
   * memory follows the sample count. The half threshold keeps a window that prunes and refills
   * from reallocating.
   */
  #shrink(): void {
    const capacity = this.#buffer.length / STRIDE;
    if (capacity > INITIAL_CAPACITY && this.#size < capacity / 2) {
      this.#compact(Math.max(INITIAL_CAPACITY, Math.ceil(this.#size * GROWTH)));
    }
  }

  /**
   * Makes room for one more sample at the end of the view: moves the view back to the start of the
   * buffer (thinning old samples on the way) while that leaves headroom, else grows the buffer.
   * A pruned window does this once per (capacity - size) inserts.
   */
  #makeRoom(): void {
    const capacity = this.#buffer.length / STRIDE;
    if (this.#data.byteOffset > 0 || this.#thinAfter !== Infinity) {
      this.#compact(capacity);
    }
    if (this.#size + 1 > capacity * COMPACT_BELOW) {
      this.#compact(Math.ceil((this.#size + 1) * GROWTH));
    }
  }

  /**
   * Copies the samples to the start of a buffer of `capacity` samples (the current one if it has
   * that size). Samples older than #thinAfter keep one per #thinSpacing interval, plus the first
   * and last sample of each run of equal values, so held values and steps stay exact.
   */
  #compact(capacity: number): void {
    const src = this.#data;
    const size = this.#size;
    const inPlace = capacity * STRIDE === this.#buffer.length;
    const dest = inPlace ? this.#buffer : new Float64Array(STRIDE * capacity);
    const srcOffset = src.byteOffset / Float64Array.BYTES_PER_ELEMENT;
    // Samples up to #thinAfter before the newest are thinned (the newest one never is). Those up to
    // #thinnedUntil already were and are copied as they are.
    const cutoff =
      this.#thinAfter === Infinity || size === 0
        ? -Infinity
        : src[(size - 1) * STRIDE]! - this.#thinAfter;
    const recent = this.#countAtMost(TIME, cutoff);
    const thinned = Math.min(recent, this.#countAtMost(TIME, this.#thinnedUntil));
    this.#thinnedUntil = Math.max(this.#thinnedUntil, cutoff);
    if (!inPlace) {
      dest.set(src.subarray(0, thinned * STRIDE));
    } else if (srcOffset !== 0 && thinned > 0) {
      dest.copyWithin(0, srcOffset, srcOffset + thinned * STRIDE);
    }
    let write = thinned;
    let lastBucket =
      thinned > 0 ? Math.floor(src[(thinned - 1) * STRIDE]! / this.#thinSpacing) : -Infinity;
    for (let read = thinned; read < recent; read++) {
      const o = read * STRIDE;
      const bucket = Math.floor(src[o]! / this.#thinSpacing);
      // read + 1 < size: the newest sample is never in the thinned part
      const samePrevious = read > 0 && this.#sameValues(o, o - STRIDE);
      const sameNext = this.#sameValues(o, o + STRIDE);
      if (bucket === lastBucket && samePrevious === sameNext) {
        continue;
      }
      lastBucket = bucket;
      const w = write * STRIDE;
      if (!inPlace || w !== srcOffset + o) {
        // dest is at or before src when they share the buffer, so copying forward is safe
        for (let k = 0; k < STRIDE; k++) {
          dest[w + k] = src[o + k]!;
        }
      }
      write++;
    }
    if (inPlace) {
      if (write * STRIDE !== srcOffset + recent * STRIDE) {
        dest.copyWithin(write * STRIDE, srcOffset + recent * STRIDE, srcOffset + size * STRIDE);
      }
    } else {
      dest.set(src.subarray(recent * STRIDE, size * STRIDE), write * STRIDE);
    }
    this.#size = write + size - recent;
    this.#buffer = dest;
    this.#data = dest;
  }

  #insertGap(index: number): void {
    if (index < this.#size) {
      this.#data.copyWithin((index + 1) * STRIDE, index * STRIDE, this.#size * STRIDE);
    }
    this.#size++;
  }

  #write(index: number, relativeTime: number, receiveTime: number, transform: Transform): void {
    const d = this.#data;
    const o = index * STRIDE;
    const p = transform.position();
    const q = transform.rotation();
    d[o] = relativeTime;
    d[o + 1] = receiveTime;
    d[o + 2] = p[0];
    d[o + 3] = p[1];
    d[o + 4] = p[2];
    d[o + 5] = q[0];
    d[o + 6] = q[1];
    d[o + 7] = q[2];
    d[o + 8] = q[3];
  }
}

const tempPosition: [number, number, number] = [0, 0, 0];
const tempRotation: [number, number, number, number] = [0, 0, 0, 1];
