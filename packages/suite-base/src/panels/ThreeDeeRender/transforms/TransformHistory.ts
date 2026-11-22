// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Transform } from "./Transform";
import { Time } from "./time";

// [time, receiveTime, x, y, z, qx, qy, qz, qw] per sample
const STRIDE = 9;
const VALUES = 2;
const INITIAL_CAPACITY = 4;

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
  #data = new Float64Array(STRIDE * INITIAL_CAPACITY);
  #size = 0;
  /** Keep one appended sample per this many; the newest one is always kept */
  #keepEvery = 1;
  /** Appended samples merged into the newest one since it was appended */
  #headInputs = 0;

  public size(): number {
    return this.#size;
  }

  public setKeepEvery(keepEvery: number): void {
    this.#keepEvery = keepEvery;
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
   * Same contract as ArrayMap.binarySearch: the index of `time`, or the bitwise complement of the
   * index it would be inserted at.
   */
  public binarySearch(time: Time, size = this.#size): number {
    if (size === 0) {
      return ~0;
    }
    const target = Number(time - this.#base);
    const d = this.#data;
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
    const until = Number(receivedUntil - this.#receiveBase);
    const d = this.#data;
    let low = 0;
    let high = this.#size;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (d[mid * STRIDE + 1]! <= until) {
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
    }
    if (receiveTime != undefined) {
      this.#receiveBase ??= receiveTime;
    }
    let receive = receiveTime == undefined ? -Infinity : Number(receiveTime - this.#receiveBase!);
    const lastIndex = this.#size - 1;
    // Fast path: samples almost always arrive in time order
    let index =
      lastIndex < 0 || Number(time - this.#base) > this.#data[lastIndex * STRIDE]!
        ? ~this.#size
        : this.binarySearch(time);
    if (index < 0) {
      index = ~index;
      if (index === this.#size && this.#size >= 2) {
        // Overwrite the newest sample instead of appending when the last two samples and this one
        // are equal (interpolation over the run gives the same result), or to keep only one in
        // #keepEvery samples. The first sample and the newest one always stay.
        if (this.#extendsRun(transform) || this.#headInputs < this.#keepEvery) {
          this.#headInputs++;
          this.#write(lastIndex, time, receive, transform);
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
    this.#write(index, time, receive, transform);
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
    return true;
  }

  /** Removes the first `count` samples */
  public removeFirst(count: number): void {
    const n = Math.min(count, this.#size);
    if (n <= 0) {
      return;
    }
    this.#data.copyWithin(0, n * STRIDE, this.#size * STRIDE);
    this.#size -= n;
  }

  public clear(): void {
    this.#size = 0;
    this.#receiveBase = undefined;
    this.#data = new Float64Array(STRIDE * INITIAL_CAPACITY);
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

  #insertGap(index: number): void {
    if ((this.#size + 1) * STRIDE > this.#data.length) {
      const grown = new Float64Array(Math.ceil(this.#data.length * 1.5) + STRIDE);
      grown.set(this.#data.subarray(0, this.#size * STRIDE));
      this.#data = grown;
    }
    if (index < this.#size) {
      this.#data.copyWithin((index + 1) * STRIDE, index * STRIDE, this.#size * STRIDE);
    }
    this.#size++;
  }

  #write(index: number, time: Time, receiveTime: number, transform: Transform): void {
    const d = this.#data;
    const o = index * STRIDE;
    const p = transform.position();
    const q = transform.rotation();
    d[o] = Number(time - this.#base);
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
