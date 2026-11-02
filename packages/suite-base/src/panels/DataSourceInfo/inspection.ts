// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time, fromNanoSec, toNanoSec } from "@foxglove/rostime";
import { IteratorResult } from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";

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
    medianEstimated: boolean;
    jitterNs: number;
    duplicateTimestamps: number;
  };
  largestInterval?: { start: Time; end: Time; nanoseconds: bigint };
};

export function bucketTime(start: Time, end: Time, index: number): Time {
  const startNs = toNanoSec(start);
  return fromNanoSec(startNs + ((toNanoSec(end) - startNs) * BigInt(index)) / BigInt(BUCKET_COUNT));
}

const INTERVAL_SAMPLE_SIZE = 8192;

/** One source pass; retain aggregates and a bounded sample of positive intervals per topic. */
export async function inspectTopics(
  iterator: AsyncIterableIterator<Readonly<IteratorResult>>,
  names: readonly string[],
  start: Time,
  end: Time,
  signal: AbortSignal,
  onProgress: (count: number) => void,
): Promise<Map<string, TopicInspection>> {
  const states = new Map<
    string,
    {
      result: TopicInspection;
      previousNs?: bigint;
      intervals: number;
      positiveIntervals: number;
      duplicates: number;
      mean: number;
      m2: number;
      minimum: number;
      maximum: number;
      sample: number[];
    }
  >(
    names.map((name) => [
      name,
      {
        result: {
          count: 0,
          bytes: 0,
          estimatedBytes: false,
          buckets: Array<number>(BUCKET_COUNT).fill(0),
        },
        previousNs: undefined as bigint | undefined,
        intervals: 0,
        positiveIntervals: 0,
        duplicates: 0,
        mean: 0,
        m2: 0,
        minimum: Infinity,
        maximum: 0,
        sample: [] as number[],
      },
    ]),
  );
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
    const { topic, receiveTime, sizeInBytes, serializedSizeInBytes } = item.msgEvent;
    const state = states.get(topic);
    const timeNs = toNanoSec(receiveTime);
    if (state == undefined || timeNs < startNs || timeNs > startNs + durationNs) {
      continue;
    }
    const { result } = state;
    result.count++;
    result.bytes += serializedSizeInBytes ?? sizeInBytes;
    result.estimatedBytes ||= serializedSizeInBytes == undefined;
    result.first ??= receiveTime;
    result.last = receiveTime;
    const bucket =
      durationNs > 0n ? Number(((timeNs - startNs) * BigInt(BUCKET_COUNT)) / durationNs) : 0;
    result.buckets[Math.min(BUCKET_COUNT - 1, bucket)]!++;
    if (state.previousNs != undefined) {
      if (timeNs < state.previousNs) {
        throw new Error("Messages arrived out of time order; interval statistics are unavailable.");
      }
      const interval = timeNs - state.previousNs;
      if (!result.largestInterval || interval > result.largestInterval.nanoseconds) {
        result.largestInterval = {
          start: fromNanoSec(state.previousNs),
          end: receiveTime,
          nanoseconds: interval,
        };
      }
      const ns = Number(interval);
      state.intervals++;
      const delta = ns - state.mean;
      state.mean += delta / state.intervals;
      state.m2 += delta * (ns - state.mean);
      if (interval === 0n) {
        state.duplicates++;
      } else {
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
    }
    state.previousNs = timeNs;
    if (++processed % 2000 === 0) {
      onProgress(processed);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  signal.throwIfAborted();
  return new Map(
    [...states].map(([name, state]) => {
      if (state.intervals > 0) {
        // Calculate median of instantaneous Hz, including the arithmetic middle pair.
        const rates = state.sample.map((ns) => 1e9 / ns).sort((a, b) => a - b);
        const middle = Math.floor(rates.length / 2);
        const medianHz =
          rates.length === 0
            ? undefined
            : rates.length % 2 === 0
              ? (rates[middle - 1]! + rates[middle]!) / 2
              : rates[middle];
        state.result.timing = {
          minimumHz: state.positiveIntervals > 0 ? 1e9 / state.maximum : undefined,
          maximumHz: state.positiveIntervals > 0 ? 1e9 / state.minimum : undefined,
          medianHz,
          medianEstimated: state.positiveIntervals > INTERVAL_SAMPLE_SIZE,
          jitterNs: Math.sqrt(Math.max(0, state.m2 / state.intervals)),
          duplicateTimestamps: state.duplicates,
        };
      }
      return [name, state.result];
    }),
  );
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
