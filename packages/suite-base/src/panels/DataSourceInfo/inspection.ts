// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time, fromNanoSec, toNanoSec } from "@foxglove/rostime";

import { MessagePipelineContext } from "@lichtblick/suite-base/components/MessagePipeline";
import { IteratorResult } from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";
import { MessageEvent, Topic } from "@lichtblick/suite-base/players/types";

export const BUCKET_COUNT = 48;

export type TopicInspection = {
  count: number;
  bytes: number;
  estimatedBytes: boolean;
  buckets: number[];
  first?: Time;
  last?: Time;
  timing?: {
    minimumHz?: number;
    maximumHz?: number;
    medianHz?: number;
    /** Median of the positive intervals (not 1 / medianHz, which differs for even counts) */
    medianIntervalNs?: number;
    medianEstimated: boolean;
    jitterNs: number;
    duplicateTimestamps: number;
  };
  /** The longest intervals between consecutive messages, longest first */
  largestIntervals: Interval[];
};

export type Interval = { start: Time; nanoseconds: bigint };

export const LARGEST_INTERVAL_COUNT = 5;

export function bucketTime(start: Time, end: Time, index: number): Time {
  const startNs = toNanoSec(start);
  return fromNanoSec(startNs + ((toNanoSec(end) - startNs) * BigInt(index)) / BigInt(BUCKET_COUNT));
}

const INTERVAL_SAMPLE_SIZE = 8192;

/** Incremental per-topic accumulator, shared by recording scans and live subscriptions. */
export type InspectionState = {
  result: TopicInspection;
  previousNs?: bigint;
  intervals: number;
  positiveIntervals: number;
  duplicates: number;
  /** Receive times that went backwards; their interval is skipped. */
  reversals: number;
  mean: number;
  m2: number;
  minimum: number;
  maximum: number;
  sample: number[];
};

export function createInspectionState(): InspectionState {
  return {
    result: {
      count: 0,
      bytes: 0,
      estimatedBytes: false,
      buckets: Array<number>(BUCKET_COUNT).fill(0),
      largestIntervals: [],
    },
    intervals: 0,
    positiveIntervals: 0,
    duplicates: 0,
    reversals: 0,
    mean: 0,
    m2: 0,
    minimum: Infinity,
    maximum: 0,
    sample: [],
  };
}

/** Adds one message, preferring the exact serialized size over the decoded estimate. */
export function updateInspection(
  state: InspectionState,
  {
    receiveTime,
    sizeInBytes,
    serializedSizeInBytes,
  }: Pick<MessageEvent, "receiveTime" | "sizeInBytes" | "serializedSizeInBytes">,
): void {
  const { result } = state;
  const timeNs = toNanoSec(receiveTime);
  result.count++;
  result.bytes += serializedSizeInBytes ?? sizeInBytes;
  result.estimatedBytes ||= serializedSizeInBytes == undefined;
  result.first ??= receiveTime;
  result.last = receiveTime;
  const previousNs = state.previousNs;
  state.previousNs = timeNs;
  if (previousNs == undefined) {
    return;
  }
  if (timeNs < previousNs) {
    state.reversals++;
    return;
  }
  const interval = timeNs - previousNs;
  const largest = result.largestIntervals;
  if (
    largest.length < LARGEST_INTERVAL_COUNT ||
    interval > largest[LARGEST_INTERVAL_COUNT - 1]!.nanoseconds
  ) {
    // Rare after the first few messages: most intervals are shorter than the shortest kept one.
    let index = Math.min(largest.length, LARGEST_INTERVAL_COUNT - 1);
    while (index > 0 && largest[index - 1]!.nanoseconds < interval) {
      index--;
    }
    largest.splice(index, 0, { start: fromNanoSec(previousNs), nanoseconds: interval });
    largest.length = Math.min(largest.length, LARGEST_INTERVAL_COUNT);
  }
  const ns = Number(interval);
  state.intervals++;
  const delta = ns - state.mean;
  state.mean += delta / state.intervals;
  state.m2 += delta * (ns - state.mean);
  if (interval === 0n) {
    state.duplicates++;
    return;
  }
  state.minimum = Math.min(state.minimum, ns);
  state.maximum = Math.max(state.maximum, ns);
  state.positiveIntervals++;
  if (state.sample.length < INTERVAL_SAMPLE_SIZE) {
    state.sample.push(ns);
  } else {
    // Reservoir sampling keeps median memory bounded independently of recording length.
    const index = Math.floor(Math.random() * state.positiveIntervals);
    if (index < INTERVAL_SAMPLE_SIZE) {
      state.sample[index] = ns;
    }
  }
}

/** Snapshot with timing statistics; the state stays usable for further updates. */
export function finishInspection(state: InspectionState): TopicInspection {
  if (state.intervals === 0) {
    return {
      ...state.result,
      largestIntervals: [...state.result.largestIntervals],
      timing: undefined,
    };
  }
  // Calculate median of instantaneous Hz, including the arithmetic middle pair.
  const rates = state.sample.map((ns) => 1e9 / ns).sort((a, b) => a - b);
  const middle = Math.floor(rates.length / 2);
  const medianHz =
    rates.length === 0
      ? undefined
      : rates.length % 2 === 0
        ? (rates[middle - 1]! + rates[middle]!) / 2
        : rates[middle];
  const intervals = [...state.sample].sort((a, b) => a - b);
  const medianIntervalNs =
    intervals.length === 0
      ? undefined
      : intervals.length % 2 === 0
        ? (intervals[middle - 1]! + intervals[middle]!) / 2
        : intervals[middle];
  return {
    ...state.result,
    largestIntervals: [...state.result.largestIntervals],
    timing: {
      minimumHz: state.positiveIntervals > 0 ? 1e9 / state.maximum : undefined,
      maximumHz: state.positiveIntervals > 0 ? 1e9 / state.minimum : undefined,
      medianHz,
      medianIntervalNs,
      medianEstimated: state.positiveIntervals > INTERVAL_SAMPLE_SIZE,
      jitterNs: Math.sqrt(Math.max(0, state.m2 / state.intervals)),
      duplicateTimestamps: state.duplicates,
    },
  };
}

/** One source pass; retain aggregates and a bounded sample of positive intervals per topic. */
export async function inspectTopics(
  iterator: AsyncIterableIterator<Readonly<IteratorResult>>,
  names: readonly string[],
  start: Time,
  end: Time,
  signal: AbortSignal,
  onProgress: (count: number) => void,
): Promise<Map<string, TopicInspection>> {
  const states = new Map(names.map((name) => [name, createInspectionState()]));
  const startNs = toNanoSec(start);
  const durationNs = toNanoSec(end) - startNs;
  let processed = 0;
  for await (const item of iterator) {
    signal.throwIfAborted();
    if (item.type === "alert") {
      throw new Error(item.alert.message);
    }
    if (item.type !== "message-event") {
      continue;
    }
    const { topic, receiveTime } = item.msgEvent;
    const state = states.get(topic);
    const timeNs = toNanoSec(receiveTime);
    if (state == undefined || timeNs < startNs || timeNs > startNs + durationNs) {
      continue;
    }
    updateInspection(state, item.msgEvent);
    if (state.reversals > 0) {
      throw new Error("Messages arrived out of time order; interval statistics are unavailable.");
    }
    const bucket =
      durationNs > 0n ? Number(((timeNs - startNs) * BigInt(BUCKET_COUNT)) / durationNs) : 0;
    state.result.buckets[Math.min(BUCKET_COUNT - 1, bucket)]!++;
    if (++processed % 2000 === 0) {
      onProgress(processed);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  signal.throwIfAborted();
  return new Map([...states].map(([name, state]) => [name, finishInspection(state)]));
}

export async function inspectTopic(
  iterator: AsyncIterableIterator<Readonly<IteratorResult>>,
  start: Time,
  end: Time,
  signal: AbortSignal,
  onProgress: (count: number) => void,
): Promise<TopicInspection> {
  // Legacy single-topic callers do not pass a topic name.
  async function* singleTopic() {
    for await (const item of iterator) {
      yield item.type === "message-event"
        ? { ...item, msgEvent: { ...item.msgEvent, topic: "" } }
        : item;
    }
  }
  return (await inspectTopics(singleTopic(), [""], start, end, signal, onProgress)).get("")!;
}

export function aggregateBuckets(inspections: Iterable<TopicInspection>): number[] {
  const buckets = Array<number>(BUCKET_COUNT).fill(0);
  for (const inspection of inspections) {
    for (const [index, count] of inspection.buckets.entries()) {
      buckets[index]! += count;
    }
  }
  return buckets;
}

/**
 * Inspects `names` (display names, resolving aliases) over [start, end], preferring the shared
 * undecoded iterator and falling back to one decoded iterator per topic.
 */
export async function inspectSourceTopics(options: {
  pipeline: Pick<MessagePipelineContext, "getBatchIterator" | "getInspectionIterator">;
  topics: readonly Topic[];
  names: readonly string[];
  start: Time;
  end: Time;
  signal: AbortSignal;
  onProgress: (count: number) => void;
  onResult: (results: ReadonlyMap<string, TopicInspection>) => void;
}): Promise<void> {
  const { pipeline, topics, names, start, end, signal, onProgress, onResult } = options;
  const sourceName = (name: string) =>
    topics.find((topic) => topic.name === name)?.aliasedFromName ?? name;
  const sourceNames = [...new Set(names.map(sourceName))];
  const shared = pipeline.getInspectionIterator?.(sourceNames, { start, end });
  if (shared) {
    const results = await inspectTopics(shared, sourceNames, start, end, signal, onProgress);
    onResult(new Map(names.map((name) => [name, results.get(sourceName(name))!])));
    return;
  }
  // Virtual topics and third-party players may only provide decoded single-topic iterators.
  for (const name of names) {
    signal.throwIfAborted();
    const iterator = pipeline.getBatchIterator(sourceName(name), { start, end });
    if (!iterator) {
      throw new Error("This source does not support recording inspection.");
    }
    onResult(new Map([[name, await inspectTopic(iterator, start, end, signal, onProgress)]]));
  }
}
