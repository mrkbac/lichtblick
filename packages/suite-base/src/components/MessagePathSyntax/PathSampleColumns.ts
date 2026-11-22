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

// One sample = receive sec, receive nsec, header sec, header nsec, value index.
const STRIDE = 5;
const NO_STAMP = 0xffffffff;
const INITIAL_CAPACITY = 1024;
/** Recently seen values checked before the value maps. */
const RECENT = 4;
const INVALID: SampleValue = { count: 1, value: undefined, constantName: undefined };

/**
 * Samples of one message path, oldest first, in 20 bytes each: timestamps in a typed array and
 * each distinct value stored once.
 *
 * At most `maxSamples` are kept. Reaching it first drops samples that repeat the value on both
 * sides (they only matter for drawn points, not for where states change), then, if that frees
 * too little, every other sample across the whole history; from then on only every `stride`-th new
 * sample is kept (plus always the newest), so density stays even over time. A long history keeps
 * its full span at a lower resolution instead of losing its start.
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
  #stride = 1;
  /** Samples pushed since the last one kept for good. */
  #sinceKept = 0;

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

  /** Appends a message's decoded value; samples must arrive in message order. */
  public pushMessage(message: MessageEvent, queriedData: readonly MessagePathDataItem[]): void {
    this.push(toPathSample(message, queriedData));
  }

  public push(sample: PathSample): void {
    // The newest sample is held provisionally until it is the stride-th one.
    if (this.#sinceKept > 0) {
      this.#length--;
    }
    if (this.#length >= this.maxSamples) {
      this.#thin();
    }
    if ((this.#length + 1) * STRIDE > this.#data.length) {
      const capacity = Math.min(this.maxSamples, (this.#data.length / STRIDE) * 2);
      const grown = new Uint32Array(capacity * STRIDE);
      grown.set(this.#data);
      this.#data = grown;
    }
    const at = this.#length * STRIDE;
    const data = this.#data;
    data[at] = sample.receiveTime.sec;
    data[at + 1] = sample.receiveTime.nsec;
    data[at + 2] = sample.headerStamp?.sec ?? 0;
    data[at + 3] = sample.headerStamp?.nsec ?? NO_STAMP;
    data[at + 4] = this.#valueIndex(sample);
    this.#length++;
    if (this.#stride > 1) {
      this.#sinceKept = (this.#sinceKept + 1) % this.#stride;
    }
  }

  public receiveTime(i: number): Time {
    return { sec: this.#data[i * STRIDE]!, nsec: this.#data[i * STRIDE + 1]! };
  }

  public headerStamp(i: number): Time | undefined {
    const nsec = this.#data[i * STRIDE + 3]!;
    return nsec === NO_STAMP ? undefined : { sec: this.#data[i * STRIDE + 2]!, nsec };
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

  #valueIndex(sample: SampleValue): number {
    // States mostly repeat or alternate between a few values: check the recent ones before the maps.
    const { value, constantName, count } = sample;
    for (let slot = 0; slot < RECENT; slot++) {
      if (
        this.#recentIndex[slot] !== -1 &&
        value === this.#recentValue[slot] &&
        constantName === this.#recentConstantName[slot] &&
        count === this.#recentCount[slot]
      ) {
        return this.#recentIndex[slot]!;
      }
    }
    const index = this.#lookUpValueIndex(sample);
    const slot = this.#nextRecent;
    this.#nextRecent = (slot + 1) % RECENT;
    this.#recentValue[slot] = value;
    this.#recentConstantName[slot] = constantName;
    this.#recentCount[slot] = count;
    this.#recentIndex[slot] = index;
    return index;
  }

  #lookUpValueIndex({ count, value, constantName }: SampleValue): number {
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

  #thin(): void {
    const data = this.#data;
    const n = this.#length;
    const target = Math.floor((this.maxSamples * 3) / 4);

    // Drop samples whose value equals both neighbours'.
    let kept = 0;
    for (let i = 0; i < n; i++) {
      const value = data[i * STRIDE + 4];
      const isRepeat =
        i > 0 &&
        i < n - 1 &&
        value === data[(i - 1) * STRIDE + 4] &&
        value === data[(i + 1) * STRIDE + 4];
      if (!isRepeat) {
        data.copyWithin(kept * STRIDE, i * STRIDE, (i + 1) * STRIDE);
        kept++;
      }
    }

    // Still too dense: keep every other sample (and the newest) until there is room.
    while (kept > target) {
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
        remap[old] = this.#valueIndex(oldValues[old]!);
      }
      this.#data[at] = remap[old]!;
    }
  }
}
