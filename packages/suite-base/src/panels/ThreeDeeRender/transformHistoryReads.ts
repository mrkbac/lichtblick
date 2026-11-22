// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromNanoSec } from "@foxglove/rostime";

import Logger from "@lichtblick/log";
import { MessageEvent } from "@lichtblick/suite";
import { BuiltinPanelExtensionContext } from "@lichtblick/suite-base/components/PanelExtensionAdapter";

const log = Logger.getLogger(__filename);

export type TransformTopic = { topic: string; convertTo?: string };

type SubscribeRange = BuiltinPanelExtensionContext["unstable_subscribeMessageRange"];

/**
 * Reads every topic in [start, end] (whole recording when omitted) and passes each batch to
 * `onBatch`. Resolves once all topics are read, failed or were cancelled, at once for topics
 * without a range (live sources): to false if any read failed. `onTopicDone` only reports a topic
 * read to its end.
 */
export async function readTransformRange(args: {
  subscribeRange: SubscribeRange;
  topics: readonly TransformTopic[];
  start?: bigint;
  end?: bigint;
  onBatch: (batch: readonly MessageEvent[], source: TransformTopic) => void;
  /** Called when a topic is read to its end without errors */
  onTopicDone?: (source: TransformTopic) => void;
  signal: AbortSignal;
}): Promise<boolean> {
  const { subscribeRange, topics, start, end, onBatch, onTopicDone, signal } = args;
  let failed = false;
  const cancels: (() => void)[] = [];
  const reads = topics.map(async (source) => {
    await new Promise<void>((resolve) => {
      const range = { started: false };
      cancels.push(
        subscribeRange({
          topic: source.topic,
          convertTo: source.convertTo,
          start: start != undefined ? fromNanoSec(start < 0n ? 0n : start) : undefined,
          end: end != undefined ? fromNanoSec(end) : undefined,
          // A failed read must not count as read to the end
          rethrowErrors: true,
          onNewRangeIterator: async (batches) => {
            range.started = true;
            try {
              for await (const batch of batches) {
                if (signal.aborted) {
                  break;
                }
                if (batch.length > 0) {
                  onBatch(batch, source);
                }
              }
              if (!signal.aborted) {
                onTopicDone?.(source);
              }
            } catch (err: unknown) {
              // Leave the unread part to the reads around seeks
              failed = true;
              log.error(`Reading transforms from ${source.topic} failed:`, err);
            } finally {
              resolve();
            }
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
  return !failed;
}

/** Lookback windows read before a seek target, newest first */
export const SEEK_LOOKBACK_NS = [2e9, 8e9, 32e9, 128e9].map(BigInt);

/**
 * After a seek to `time`, read the transform topics just before it, so every frame has its latest
 * transform at `time`. Starts with a short window and widens it over older slices while
 * `isMissing()` says some known frame got no transform from the read yet. Never reads before
 * `floor`, the time up to which the history is already complete. Resolves to false if a read
 * failed: it stops there, since older windows cannot stand in for the unread part.
 */
export async function readTransformsBefore(args: {
  subscribeRange: SubscribeRange;
  topics: readonly TransformTopic[];
  time: bigint;
  floor: bigint;
  isMissing: () => boolean;
  onBatch: (batch: readonly MessageEvent[]) => void;
  signal: AbortSignal;
}): Promise<boolean> {
  const { time, floor, isMissing, signal } = args;
  let end = time;
  for (const lookback of SEEK_LOOKBACK_NS) {
    const start = time - lookback > floor ? time - lookback : floor;
    if (start > end) {
      return true;
    }
    if (!(await readTransformRange({ ...args, start, end }))) {
      return false;
    }
    if (signal.aborted || start <= floor || !isMissing()) {
      return true;
    }
    // Next window only reads the older part; ranges are inclusive, so step one nanosecond back
    end = start - 1n;
  }
  return true;
  // ponytail: frames silent for over SEEK_LOOKBACK_NS stay missing (e.g. a dynamic frame that
  // stopped publishing long ago); widen the last window if that matters.
}
