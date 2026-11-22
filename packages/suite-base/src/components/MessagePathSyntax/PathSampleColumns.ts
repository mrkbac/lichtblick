// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";

import type { MessagePathDataItem } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import type { MessageEvent } from "@lichtblick/suite-base/players/types";
import { getTimestampForMessage } from "@lichtblick/suite-base/util/time";

/**
 * A message path's value in one message, without the message. `value` and `constantName` are only
 * set when the path matched exactly one value (`count` is 1).
 */
export type PathSample = {
  receiveTime: Time;
  /** The message's header stamp, if it has one. */
  headerStamp: Time | undefined;
  count: number;
  value: unknown;
  constantName: string | undefined;
};

/** What a sample decoded to; shared by every sample with the same value. */
export type SampleValue = Readonly<Pick<PathSample, "count" | "value" | "constantName">>;

export function toPathSample(
  message: MessageEvent,
  queriedData: readonly MessagePathDataItem[],
): PathSample {
  const only = queriedData.length === 1 ? queriedData[0] : undefined;
  return {
    receiveTime: message.receiveTime,
    headerStamp: getTimestampForMessage(message.message),
    count: queriedData.length,
    value: only?.value,
    constantName: only?.constantName,
  };
}

// One sample = receive sec, receive nsec, header sec, header nsec (NO_STAMP without one), value
// index. Seconds keep their low 32 bits and bit 31 of the nsec word (nsec < 1e9 < 2^31) marks a
// negative second, so signed ROS 2 stamps and unsigned ROS 1 ones (up to 2^32 - 1) both round-trip.
// (Float64 storage would be simpler but made ingest about 5x slower.)
const STRIDE = 5;
const NO_STAMP = 0xffffffff;
const NEGATIVE = 0x80000000;
const U32 = 0x100000000;
const INITIAL_CAPACITY = 1024;
/** Recently seen values checked before the value maps. */
const RECENT = 4;
const INVALID: SampleValue = { count: 1, value: undefined, constantName: undefined };

/**
 * Writes a time if it has a 32-bit form; a bigint (int64 schemas) is converted. Returns false for
 * anything else (out of range, not a number), which the caller treats as no time.
 */
function writeTime(data: Uint32Array, at: number, time: Time): boolean {
  const sec = typeof time.sec === "bigint" ? Number(time.sec) : time.sec;
  const nsec = typeof time.nsec === "bigint" ? Number(time.nsec) : time.nsec;
  if (!(sec >= -NEGATIVE && sec < U32 && nsec >= 0 && nsec < NEGATIVE)) {
    return false;
  }
  data[at] = sec;
  data[at + 1] = sec < 0 ? nsec + NEGATIVE : nsec;
  return true;
}

function readTime(data: Uint32Array, at: number): Time {
  const nsec = data[at + 1]!;
  return nsec >= NEGATIVE
    ? { sec: data[at]! - U32, nsec: nsec - NEGATIVE }
    : { sec: data[at]!, nsec };
}

/**
 * Samples of one message path, oldest first, in 20 bytes each: timestamps in a typed array and
 * each distinct value stored once.
 *
 * At most `maxSamples` are kept. Each time the budget is reached, the history is thinned one level
 * further, and from then on new samples are thinned the same way as they arrive:
 * 1. Drop samples between two with the same value (and the same header stamp presence). Every run
 *    of a value keeps its first and last sample.
 * 2. Also drop the last sample of a run unless a gap (null) follows: the next run's start ends it.
 *    Every value change is still kept exactly.
 * 3. Keep every other sample across the whole history; from then on only every `stride`-th new one
 *    (plus always the newest). The span stays whole at a lower resolution, but changes can merge
 *    in these samples, so from here on every change is also kept apart, exactly (`changes()`).
 */
export class PathSampleColumns {
  public readonly maxSamples: number;
  #data = new Uint32Array(INITIAL_CAPACITY * STRIDE);
  #length = 0;
  #values: SampleValue[] = [];
  /** Index into #values of each value without a constant name. */
  #indexByValue = new Map<unknown, number>();
  /** constantName -> value -> index into #values */
  #indexByNamedValue = new Map<string, Map<unknown, number>>();
  #indexByCount = new Map<number, number>();
  #invalidIndex: number | undefined;
  #recentValue: unknown[] = new Array(RECENT).fill(undefined);
  #recentConstantName: (string | undefined)[] = new Array(RECENT).fill(undefined);
  #recentCount = new Int32Array(RECENT);
  #recentIndex = new Int32Array(RECENT).fill(-1);
  #nextRecent = 0;
  /** The recent slot that matched last; checked first. */
  #lastRecent = 0;
  /** How far thinning has gone (see the class comment); 0 keeps every sample. */
  #level = 0;
  #stride = 1;
  /** Samples pushed since the last one kept for good. */
  #sinceKept = 0;
  /** Every value change, from level 3 on. */
  #changes: PathSampleColumns | undefined;

  public constructor(maxSamples: number) {
    if (!Number.isInteger(maxSamples) || maxSamples < 4) {
      throw new RangeError(`maxSamples must be a finite integer >= 4, got ${maxSamples}`);
    }
    this.maxSamples = maxSamples;
  }

  public static from(samples: Iterable<PathSample>, maxSamples = 1_000_000): PathSampleColumns {
    const columns = new PathSampleColumns(maxSamples);
    for (const sample of samples) {
      columns.push(sample);
    }
    return columns;
  }

  public size(): number {
    return this.#length;
  }

  /** Size of the value table (for tests). */
  public distinctValues(): number {
    return this.#values.length;
  }

  /**
   * Samples with every value change kept exactly, for finding where a condition starts to hold:
   * these columns, or once they are thinned past that, a separate record of only the changes.
   */
  public changes(): PathSampleColumns {
    return this.#changes ?? this;
  }

  /** Appends a message's decoded value; samples must arrive in message order. */
  public pushMessage(message: MessageEvent, queriedData: readonly MessagePathDataItem[]): void {
    const only = queriedData.length === 1 ? queriedData[0] : undefined;
    this.#append(
      message.receiveTime,
      getTimestampForMessage(message.message),
      queriedData.length,
      only?.value,
      only?.constantName,
    );
  }

  public push(sample: PathSample): void {
    this.#append(
      sample.receiveTime,
      sample.headerStamp,
      sample.count,
      sample.value,
      sample.constantName,
    );
  }

  #append(
    receiveTime: Time,
    headerStamp: Time | undefined,
    count: number,
    value: unknown,
    constantName: string | undefined,
  ): void {
    if ((this.#length + 1) * STRIDE > this.#data.length) {
      // One spare slot: the new sample is written before thinning makes room.
      const capacity = Math.min(this.maxSamples + 1, (this.#data.length / STRIDE) * 2);
      const grown = new Uint32Array(capacity * STRIDE);
      grown.set(this.#data);
      this.#data = grown;
    }
    const n = this.#length;
    const data = this.#data;
    if (!writeTime(data, n * STRIDE, receiveTime)) {
      return;
    }
    if (!headerStamp || !writeTime(data, n * STRIDE + 2, headerStamp)) {
      data[n * STRIDE + 3] = NO_STAMP;
    }
    data[n * STRIDE + 4] = this.#valueIndex(value, constantName, count);
    this.#length++;
    this.#changes?.#append(receiveTime, headerStamp, count, value, constantName);

    // The previous newest sample was held provisionally until it was the stride-th one, or is
    // one the current thinning level drops.
    if (this.#sinceKept > 0 || (this.#level > 0 && n >= 2 && this.#canDrop(n - 2, n - 1, n))) {
      data.copyWithin((n - 1) * STRIDE, n * STRIDE, (n + 1) * STRIDE);
      this.#length--;
    }
    if (this.#length > this.maxSamples) {
      this.#thin();
    }
    if (this.#stride > 1) {
      this.#sinceKept = (this.#sinceKept + 1) % this.#stride;
    }
  }

  public receiveTime(i: number): Time {
    return readTime(this.#data, i * STRIDE);
  }

  public headerStamp(i: number): Time | undefined {
    return this.hasHeaderStamp(i) ? readTime(this.#data, i * STRIDE + 2) : undefined;
  }

  /** Equal for two samples exactly when their SampleValue is the same. */
  public valueId(i: number): number {
    return this.#data[i * STRIDE + 4]!;
  }

  public hasHeaderStamp(i: number): boolean {
    return this.#data[i * STRIDE + 3] !== NO_STAMP;
  }

  public sampleValue(i: number): SampleValue {
    return this.#values[this.#data[i * STRIDE + 4]!]!;
  }

  public at(i: number): PathSample | undefined {
    if (i < 0 || i >= this.#length) {
      return undefined;
    }
    return {
      receiveTime: this.receiveTime(i),
      headerStamp: this.headerStamp(i),
      ...this.sampleValue(i),
    };
  }

  public toArray(): PathSample[] {
    return Array.from({ length: this.#length }, (_, i) => this.at(i)!);
  }

  #valueIndex(value: unknown, constantName: string | undefined, count: number): number {
    // States mostly repeat or alternate between a few values: check the recent ones before the maps.
    const last = this.#lastRecent;
    if (
      value === this.#recentValue[last] &&
      constantName === this.#recentConstantName[last] &&
      count === this.#recentCount[last] &&
      this.#recentIndex[last] !== -1
    ) {
      return this.#recentIndex[last]!;
    }
    for (let slot = 0; slot < RECENT; slot++) {
      if (
        value === this.#recentValue[slot] &&
        constantName === this.#recentConstantName[slot] &&
        count === this.#recentCount[slot] &&
        this.#recentIndex[slot] !== -1
      ) {
        this.#lastRecent = slot;
        return this.#recentIndex[slot]!;
      }
    }
    // Samples dropped by thinning leave their values behind: forget unused ones once they pile up.
    if (this.#values.length >= Math.max(INITIAL_CAPACITY, 2 * this.#length)) {
      this.#compactValues();
    }
    const index = this.#lookUpValueIndex(value, constantName, count);
    const slot = this.#nextRecent;
    this.#nextRecent = (slot + 1) % RECENT;
    this.#lastRecent = slot;
    // An object is stored as INVALID, like undefined: don't keep it alive here either.
    // eslint-disable-next-line @lichtblick/strict-equality
    this.#recentValue[slot] = typeof value === "object" && value !== null ? undefined : value;
    this.#recentConstantName[slot] = constantName;
    this.#recentCount[slot] = count;
    this.#recentIndex[slot] = index;
    return index;
  }

  #lookUpValueIndex(value: unknown, constantName: string | undefined, count: number): number {
    if (count !== 1) {
      let index = this.#indexByCount.get(count);
      if (index == undefined) {
        index = this.#values.push({ count, value: undefined, constantName: undefined }) - 1;
        this.#indexByCount.set(count, index);
      }
      return index;
    }
    // Objects and arrays can't be drawn as a state, and keying them would keep every one alive.
    // eslint-disable-next-line @lichtblick/strict-equality
    if (value === undefined || (typeof value === "object" && value !== null)) {
      return (this.#invalidIndex ??= this.#values.push(INVALID) - 1);
    }
    let byValue = this.#indexByValue;
    if (constantName != undefined) {
      byValue = this.#indexByNamedValue.get(constantName) ?? new Map();
      this.#indexByNamedValue.set(constantName, byValue);
    }
    let index = byValue.get(value);
    if (index == undefined) {
      index = this.#values.push({ count, value, constantName }) - 1;
      byValue.set(value, index);
    }
    return index;
  }

  /** Whether sample `i` can go at the current level, given the kept one before and the next. */
  #canDrop(prev: number, i: number, next: number): boolean {
    const id = this.valueId(i);
    const stamped = this.hasHeaderStamp(i);
    if (id !== this.valueId(prev) || stamped !== this.hasHeaderStamp(prev)) {
      return false; // i starts a run
    }
    if (id === this.valueId(next) && stamped === this.hasHeaderStamp(next)) {
      return true; // i is inside a run
    }
    // At level 2 a run's last sample is only kept to end it before a gap.
    // eslint-disable-next-line @lichtblick/strict-equality
    return this.#level >= 2 && this.sampleValue(next).value !== null;
  }

  #thin(): void {
    const data = this.#data;
    const target = Math.floor((this.maxSamples * 3) / 4);

    while (this.#level < 2 && this.#length > target) {
      this.#level++;
      const n = this.#length;
      let kept = 1;
      for (let i = 1; i < n; i++) {
        if (i === n - 1 || !this.#canDrop(kept - 1, i, i + 1)) {
          data.copyWithin(kept * STRIDE, i * STRIDE, (i + 1) * STRIDE);
          kept++;
        }
      }
      this.#length = kept;
    }

    if (this.#length > target && !this.#changes) {
      // Every sample left is a change: keep them apart before halving merges some.
      // ponytail: the changes record has no budget; it grows 20 bytes per value change.
      const changes = new PathSampleColumns(Number.MAX_SAFE_INTEGER);
      changes.#level = 2;
      for (let i = 0; i < this.#length; i++) {
        changes.push(this.at(i)!);
      }
      this.#changes = changes;
    }

    // Still too dense: keep every other sample (and the newest) until there is room.
    let kept = this.#length;
    while (kept > target) {
      this.#level = 3;
      let half = 0;
      for (let i = 0; i < kept; i += 2) {
        data.copyWithin(half * STRIDE, i * STRIDE, (i + 1) * STRIDE);
        half++;
      }
      if (kept % 2 === 0) {
        data.copyWithin(half * STRIDE, (kept - 1) * STRIDE, kept * STRIDE);
        half++;
      }
      kept = half;
      this.#stride *= 2;
    }
    this.#length = kept;
    this.#compactValues();
  }

  /** Forgets values no kept sample uses, so a stream of distinct values can't grow the table. */
  #compactValues(): void {
    const oldValues = this.#values;
    const remap = new Int32Array(oldValues.length).fill(-1);
    this.#values = [];
    this.#indexByValue.clear();
    this.#indexByNamedValue.clear();
    this.#indexByCount.clear();
    this.#invalidIndex = undefined;
    this.#recentIndex.fill(-1);
    for (let i = 0; i < this.#length; i++) {
      const at = i * STRIDE + 4;
      const old = this.#data[at]!;
      if (remap[old] === -1) {
        const { value, constantName, count } = oldValues[old]!;
        remap[old] = this.#lookUpValueIndex(value, constantName, count);
      }
      this.#data[at] = remap[old]!;
    }
  }
}
