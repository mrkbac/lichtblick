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
// word. Seconds keep their low 32 bits and bit 31 of the nsec word (nsec < 1e9 < 2^31) marks a
// negative second, so signed ROS 2 stamps and unsigned ROS 1 ones (up to 2^32 - 1) both round-trip.
// (Float64 storage would be simpler but made ingest about 5x slower.)
// The value word is an index into the value table, or NUMBER for a plain number, which is kept in
// a Float64Array column instead: no table entry per distinct float. Bit 31 (MIXED) marks a sample
// standing for a merged stretch that held more than one value.
const STRIDE = 5;
const NO_STAMP = 0xffffffff;
const NEGATIVE = 0x80000000;
const U32 = 0x100000000;
const MIXED = 0x80000000;
const NUMBER = 0x7fffffff;
const INITIAL_CAPACITY = 1024;
/** Recently seen values checked before the value maps. */
const RECENT = 4;
const INVALID: SampleValue = { count: 1, value: undefined, constantName: undefined };

/**
 * Writes a time if it is a valid one with a 32-bit form; a bigint (int64 schemas) is converted.
 * Returns false for anything else, which the caller treats as no time.
 */
function writeTime(data: Uint32Array, at: number, time: Time): boolean {
  const sec = typeof time.sec === "bigint" ? Number(time.sec) : time.sec;
  const nsec = typeof time.nsec === "bigint" ? Number(time.nsec) : time.nsec;
  if (!(Number.isInteger(sec) && sec >= -NEGATIVE && sec < U32 && nsec >= 0 && nsec < 1e9)) {
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
 * Samples of one message path, oldest first, in 20 bytes each (28 for plain numbers): timestamps
 * in a typed array, numbers in another, and each other distinct value stored once.
 *
 * At most `maxSamples` are kept. Each time the budget is reached, the history is thinned one level
 * further, and from then on new samples are thinned the same way as they arrive:
 * 1. Drop samples between two with the same value (and the same header stamp presence). Every run
 *    of a value keeps its first and last sample.
 * 2. Also drop the last sample of a run unless a gap (null) follows: the next run's start ends it.
 *    Every value change is still kept exactly.
 * 3. Merge neighbouring samples in pairs across the whole history, and from then on every
 *    `stride` new ones. A merged sample that saw more than one value is marked (`isMixed`) and
 *    drawn as a dense stretch, so a fast signal never aliases into a wrong steady state. The span
 *    stays whole at a lower resolution. With `trackChanges()`, the changes are kept apart from here
 *    on (`changes()`), so where a condition starts to hold stays exact.
 */
export class PathSampleColumns {
  public readonly maxSamples: number;
  #data = new Uint32Array(INITIAL_CAPACITY * STRIDE);
  /** Values of NUMBER samples; allocated with the first one. */
  #numbers: Float64Array | undefined;
  #length = 0;
  #prefixRevision = 0;
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
  /** Samples since the newest kept one, while merging (level 3). */
  #sinceKept = 0;
  /** Whether the newest sample is only held until the next one, which merges it into the kept one. */
  #provisional = false;
  #trackChanges = false;
  /** Every value change, from level 3 on, when tracking changes. */
  #changes: PathSampleColumns | undefined;
  /** Set on a changes record: past its budget it forgets its oldest changes instead of merging. */
  #isChangesRecord = false;
  #forgotChanges = false;
  #startedTrackingLate = false;
  /** Made from columns that had lost changes already (see concat) */
  #lostChanges = false;

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

  /**
   * `earlier`'s samples followed by `later`'s (all after them), thinned again to fit `later`'s
   * budget: for history read around the playhead first, whose earlier windows come last. Samples
   * already merged stay merged; with tracked changes, changes either side had forgotten stay
   * forgotten (`hasAllChanges`).
   */
  public static concat(earlier: PathSampleColumns, later: PathSampleColumns): PathSampleColumns {
    const merged = new PathSampleColumns(later.maxSamples);
    if (later.#trackChanges || earlier.#trackChanges) {
      merged.trackChanges();
    }
    for (const source of [earlier, later]) {
      for (let i = 0; i < source.#length; i++) {
        merged.push(source.at(i)!);
        if (source.isMixed(i)) {
          merged.#setMixed(merged.#length - 1);
        }
      }
    }
    merged.#lostChanges = !(earlier.hasAllChanges() && later.hasAllChanges());
    return merged;
  }

  public size(): number {
    return this.#length;
  }

  /** Changes when compaction can rewrite rows before the newest two. */
  public prefixRevision(): number {
    return this.#prefixRevision;
  }

  /** Size of the value table (for tests). */
  public distinctValues(): number {
    return this.#values.length;
  }

  /** Keep the exact value changes apart once thinning starts merging (for condition matches). */
  public trackChanges(): void {
    if (!this.#trackChanges && this.#level === 3) {
      this.#startedTrackingLate = true;
    }
    this.#trackChanges = true;
  }

  /**
   * Samples with every value change kept exactly, for finding where a condition starts to hold:
   * these columns, or once they merge samples, the separate record of changes (see trackChanges).
   */
  public changes(): PathSampleColumns {
    return this.#changes ?? this;
  }

  /** Whether the retained history still records all value changes. */
  public hasAllChanges(): boolean {
    if (this.#lostChanges) {
      return false;
    }
    return this.#changes
      ? !this.#startedTrackingLate && !this.#changes.#forgotChanges
      : this.#level < 3;
  }

  /**
   * True for a changes record that forgot its oldest changes: its first sample is the last
   * forgotten one, kept only for the state before the first kept change, not as a change itself.
   */
  public startsWithContext(): boolean {
    return this.#forgotChanges;
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
      if (this.#numbers) {
        const numbers = new Float64Array(capacity);
        numbers.set(this.#numbers);
        this.#numbers = numbers;
      }
    }
    const n = this.#length;
    const data = this.#data;
    if (!writeTime(data, n * STRIDE, receiveTime)) {
      return;
    }
    if (!headerStamp || !writeTime(data, n * STRIDE + 2, headerStamp)) {
      data[n * STRIDE + 3] = NO_STAMP;
    }
    if (typeof value === "number" && count === 1 && constantName == undefined) {
      this.#numbers ??= new Float64Array(data.length / STRIDE);
      this.#numbers[n] = value;
      data[n * STRIDE + 4] = NUMBER;
    } else {
      data[n * STRIDE + 4] = this.#valueIndex(value, constantName, count);
    }
    this.#length++;
    if (this.#changes) {
      this.#changes.#append(receiveTime, headerStamp, count, value, constantName);
    }

    if (this.#provisional) {
      // Merging (level 3): the kept sample before also stands for the previous newest one, which
      // this one replaces as the newest (so the chart still reaches the latest time).
      const mixed = !this.sameValue(n - 2, n - 1) || this.isMixed(n - 2);
      if (!this.hasHeaderStamp(n - 2) && this.hasHeaderStamp(n - 1)) {
        // Keep a header-stamped sample for the merged stretch, so a row drawn by stamp can't vanish.
        this.#move(n - 2, n - 1);
      }
      if (mixed) {
        this.#setMixed(n - 2);
      }
      this.#move(n - 1, n);
      this.#length--;
    } else if (this.#level > 0 && n >= 2 && this.#canDrop(n - 2, n - 1, n)) {
      this.#move(n - 1, n);
      this.#length--;
    }
    if (this.#stride > 1) {
      // Every `stride`-th sample is kept; the ones in between are merged into it.
      this.#provisional = this.#sinceKept !== 0;
      this.#sinceKept = (this.#sinceKept + 1) % this.#stride;
    }
    if (this.#length > this.maxSamples) {
      this.#thin();
    }
  }

  public receiveTime(i: number): Time {
    return readTime(this.#data, i * STRIDE);
  }

  public headerStamp(i: number): Time | undefined {
    return this.hasHeaderStamp(i) ? readTime(this.#data, i * STRIDE + 2) : undefined;
  }

  public hasHeaderStamp(i: number): boolean {
    return this.#data[i * STRIDE + 3] !== NO_STAMP;
  }

  /** Whether samples i and j have the same SampleValue (and are both merged or both not). */
  public sameValue(i: number, j: number): boolean {
    const word = this.#data[i * STRIDE + 4]!;
    return (
      word === this.#data[j * STRIDE + 4] &&
      ((word & NUMBER) !== NUMBER || this.#numbers![i] === this.#numbers![j])
    );
  }

  /** Whether sample i stands for a merged stretch that held more than one value (level 3). */
  public isMixed(i: number): boolean {
    return this.#data[i * STRIDE + 4]! >= MIXED;
  }

  public sampleValue(i: number): SampleValue {
    const index = this.#data[i * STRIDE + 4]! & NUMBER;
    if (index === NUMBER) {
      return { count: 1, value: this.#numbers![i], constantName: undefined };
    }
    return this.#values[index]!;
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

  #move(to: number, from: number): void {
    this.#data.copyWithin(to * STRIDE, from * STRIDE, (from + 1) * STRIDE);
    if (this.#numbers) {
      this.#numbers[to] = this.#numbers[from]!;
    }
  }

  #setMixed(i: number): void {
    const word = this.#data[i * STRIDE + 4]!;
    if (word < MIXED) {
      this.#data[i * STRIDE + 4] = word + MIXED;
    }
  }

  #isGap(i: number): boolean {
    const index = this.#data[i * STRIDE + 4]! & NUMBER;
    // eslint-disable-next-line @lichtblick/strict-equality
    return index !== NUMBER && this.#values[index]!.value === null;
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
    const stamped = this.hasHeaderStamp(i);
    if (!this.sameValue(prev, i) || stamped !== this.hasHeaderStamp(prev)) {
      return false; // i starts a run
    }
    if (this.sameValue(i, next) && stamped === this.hasHeaderStamp(next)) {
      return true; // i is inside a run
    }
    // At level 2 a run's last sample is only kept to end it before a gap, or before a sample
    // that differs in having a header stamp (it is where the run ends when drawn by stamp).
    return this.#level >= 2 && !this.#isGap(next) && stamped === this.hasHeaderStamp(next);
  }

  #thin(): void {
    this.#prefixRevision++;
    const target = Math.floor((this.maxSamples * 3) / 4);

    if (this.#isChangesRecord) {
      // Forget the oldest changes; the merged chart samples still cover that time. The last
      // forgotten one stays as the first sample, so the state before the first kept change is
      // known (`startsWithContext` tells readers not to treat that first sample as a change).
      const drop = this.#length - target - 1;
      this.#data.copyWithin(0, drop * STRIDE, this.#length * STRIDE);
      this.#numbers?.copyWithin(0, drop, this.#length);
      this.#length = target + 1;
      this.#forgotChanges = true;
      this.#compactValues();
      return;
    }

    while (this.#level < 2 && this.#length > target) {
      this.#level++;
      const n = this.#length;
      let kept = 1;
      for (let i = 1; i < n; i++) {
        if (i === n - 1 || !this.#canDrop(kept - 1, i, i + 1)) {
          this.#move(kept, i);
          kept++;
        }
      }
      this.#length = kept;
    }

    if (this.#length > target && this.#trackChanges && !this.#changes) {
      // Every sample left is a change: keep them apart before merging blurs some.
      const changes = new PathSampleColumns(this.maxSamples);
      changes.#isChangesRecord = true;
      changes.#level = 2;
      for (let i = 0; i < this.#length; i++) {
        changes.push(this.at(i)!);
      }
      this.#changes = changes;
    }

    // Still too dense: merge neighbours in pairs until there is room.
    let kept = this.#length;
    while (kept > target) {
      this.#level = 3;
      let half = 0;
      for (let i = 0; i < kept; i += 2) {
        const mixed = i + 1 < kept && !this.sameValue(i, i + 1);
        // Keep a header-stamped sample if the pair has one, so a row drawn by stamp can't vanish.
        const keep =
          i + 1 < kept && !this.hasHeaderStamp(i) && this.hasHeaderStamp(i + 1) ? i + 1 : i;
        this.#move(half, keep);
        if (mixed) {
          this.#setMixed(half);
        }
        half++;
      }
      kept = half;
      this.#stride *= 2;
      this.#sinceKept = 0;
      this.#provisional = false;
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
      const word = this.#data[at]!;
      const old = word & NUMBER;
      if (old === NUMBER) {
        continue;
      }
      if (remap[old] === -1) {
        const { value, constantName, count } = oldValues[old]!;
        remap[old] = this.#lookUpValueIndex(value, constantName, count);
      }
      this.#data[at] = remap[old]! + (word >= MIXED ? MIXED : 0);
    }
  }
}
