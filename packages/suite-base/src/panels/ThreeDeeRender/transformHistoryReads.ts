// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromNanoSec } from "@foxglove/rostime";

import { MessageEvent, PanelExtensionContext } from "@lichtblick/suite";

export type TransformTopic = { topic: string; convertTo?: string };

type SubscribeRange = PanelExtensionContext["unstable_subscribeMessageRange"];

/**
 * Reads every topic in [start, end] (whole recording when omitted) and passes each batch to
 * `onBatch`. Resolves once all topics are read, at once for topics without a range (live sources),
 * or when `signal` aborts.
 */
export async function readTransformRange(args: {
  subscribeRange: SubscribeRange;
  topics: readonly TransformTopic[];
  start?: bigint;
  end?: bigint;
  onBatch: (batch: readonly MessageEvent[], topic: string) => void;
  /** Called when a topic is fully read */
  onTopicDone?: (topic: string) => void;
  signal: AbortSignal;
}): Promise<void> {
  const { subscribeRange, topics, start, end, onBatch, onTopicDone, signal } = args;
  const cancels: (() => void)[] = [];
  const reads = topics.map(async ({ topic, convertTo }) => {
    await new Promise<void>((resolve) => {
      const range = { started: false };
      cancels.push(
        subscribeRange({
          topic,
          convertTo,
          start: start != undefined ? fromNanoSec(start < 0n ? 0n : start) : undefined,
          end: end != undefined ? fromNanoSec(end) : undefined,
          onNewRangeIterator: async (batches) => {
            range.started = true;
            for await (const batch of batches) {
              if (signal.aborted) {
                break;
              }
              if (batch.length > 0) {
                onBatch(batch, topic);
              }
            }
            if (!signal.aborted) {
              onTopicDone?.(topic);
            }
            resolve();
          },
        }),
      );
      if (!range.started) {
        // Ranges start synchronously; a source without one (live) never calls back
        resolve();
      }
      signal.addEventListener("abort", () => {
        resolve();
      });
    });
  });
  signal.addEventListener("abort", () => {
    for (const cancel of cancels) {
      cancel();
    }
  });
  await Promise.all(reads);
}

/** Lookback windows read before a seek target, newest first */
export const SEEK_LOOKBACK_NS = [2e9, 8e9, 32e9, 128e9].map(BigInt);

/**
 * After a seek to `time`, read the transform topics just before it, so every frame has its latest
 * transform at `time`. Starts with a short window and widens it while `isMissing(windowStart)` says
 * some known frame still has no transform in [windowStart, time]. Never reads before `floor`, the
 * time up to which the history is already complete.
 */
export async function readTransformsBefore(args: {
  subscribeRange: SubscribeRange;
  topics: readonly TransformTopic[];
  time: bigint;
  floor: bigint;
  isMissing: (windowStart: bigint) => boolean;
  onBatch: (batch: readonly MessageEvent[]) => void;
  signal: AbortSignal;
}): Promise<void> {
  const { time, floor, isMissing, signal } = args;
  let end = time;
  for (const lookback of SEEK_LOOKBACK_NS) {
    const start = time - lookback > floor ? time - lookback : floor;
    if (start >= end) {
      return;
    }
    await readTransformRange({ ...args, start, end });
    if (signal.aborted || start <= floor || !isMissing(start)) {
      return;
    }
    // Next window only reads the older part; ranges are inclusive, so step one nanosecond back
    end = start - 1n;
  }
  // ponytail: frames silent for over SEEK_LOOKBACK_NS stay missing (e.g. a static topic published
  // once at the start while preloading is off); widen the last window if that matters.
}
