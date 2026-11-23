// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare, toNanoSec } from "@foxglove/rostime";
import { Heap } from "heap-js";

import {
  IIterableSource,
  IteratorResult,
  MessageIteratorArgs,
} from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";
import {
  SequentialIteratorMergeOptions,
  SourceWithTime,
} from "@lichtblick/suite-base/players/IterablePlayer/shared/types";

/**
 * Lazily merges sources in start-time order, activating each iterator only when playback reaches
 * that source's time range. This avoids starting remote reads for every file at once.
 */
export async function* mergeSequentialIterators<T extends IteratorResult>(
  sources: IIterableSource[],
  args: MessageIteratorArgs,
): AsyncIterableIterator<Readonly<T>> {
  // Separate sources into those with known time ranges and those without.
  // Sources without time ranges are started immediately (conservative approach).
  const sourcesWithTime: SourceWithTime[] = [];
  const sourcesWithoutTime: IIterableSource[] = [];

  for (const source of sources) {
    const startTime = source.getStart?.();
    const endTime = source.getEnd?.();
    if (startTime && endTime) {
      sourcesWithTime.push({ source, startTime, endTime });
    } else {
      sourcesWithoutTime.push(source);
    }
  }

  sourcesWithTime.sort((a, b) => compare(a.startTime, b.startTime));

  const heap = new Heap<SequentialIteratorMergeOptions<T>>((a, b) =>
    a.time < b.time ? -1 : a.time > b.time ? 1 : 0,
  );

  // Tracks every iterator that has been activated (messageIterator() called and not yet
  // exhausted). Unlike the heap, this includes the iterator whose value is currently being
  // yielded (removed from the heap by `pop()` before `yield`), so cancellation while suspended
  // at that yield can still clean it up in `finally`.
  const activeIterators = new Set<AsyncIterableIterator<Readonly<IteratorResult>>>();

  /** Activate a source iterator and push its first value onto the heap if present. */
  async function activateSource(source: IIterableSource, startTime?: bigint): Promise<void> {
    const iterator = source.messageIterator(args);
    activeIterators.add(iterator);
    const result = await iterator.next();
    if (!(result.done ?? false)) {
      const value = result.value as T;
      heap.push({ value, iterator, time: getTime(value) ?? startTime ?? 0n });
    } else {
      // Exhausted immediately (empty source): nothing left to clean up.
      activeIterators.delete(iterator);
    }
  }

  // Index into the sorted sourcesWithTime array tracking the next source to potentially activate
  let nextSourceIndex = 0;

  /** Activate the next pending timed source. */
  async function activateNextSource(): Promise<void> {
    const { source, startTime } = sourcesWithTime[nextSourceIndex]!;
    await activateSource(source, toNanoSec(startTime));
    nextSourceIndex++;
  }

  try {
    // Start sources without time info eagerly.
    for (const source of sourcesWithoutTime) {
      await activateSource(source);
    }

    // On seek, start only sources whose range can contain queryStart; otherwise start just the
    // earliest source. Additional sources are activated lazily as playback reaches them so we
    // do not open remote reads for every file up front.
    const queryStart = args.start;
    if (queryStart != undefined) {
      // Skip sources that end before queryStart.
      while (nextSourceIndex < sourcesWithTime.length) {
        const sourceInfo = sourcesWithTime[nextSourceIndex]!;
        if (compare(sourceInfo.endTime, queryStart) >= 0) {
          break;
        }
        nextSourceIndex++;
      }
      // Activate sources that contain queryStart.
      while (nextSourceIndex < sourcesWithTime.length) {
        const sourceInfo = sourcesWithTime[nextSourceIndex]!;
        if (compare(sourceInfo.startTime, queryStart) > 0) {
          break;
        }
        await activateNextSource();
      }
    } else {
      // No query start: activate only the first source.
      if (nextSourceIndex < sourcesWithTime.length) {
        await activateNextSource();
      }
    }

    // If the initial source(s) were empty, advance through pending sources until
    // we find one with data or exhaust all sources.
    while (heap.isEmpty() && nextSourceIndex < sourcesWithTime.length) {
      await activateNextSource();
    }

    while (!heap.isEmpty()) {
      const node = heap.pop()!;

      // Activate any pending sources whose startTime is <= the current message time.
      let activated = false;
      while (nextSourceIndex < sourcesWithTime.length) {
        const sourceInfo = sourcesWithTime[nextSourceIndex]!;
        if (toNanoSec(sourceInfo.startTime) > node.time) {
          break;
        }
        await activateNextSource();
        activated = true;
      }
      if (activated) {
        // A newly opened source may have a message before this one
        heap.push(node);
        continue;
      }

      yield node.value;

      const nextResult = await node.iterator.next();
      if (!(nextResult.done ?? false)) {
        const value = nextResult.value as T;
        heap.push({ value, iterator: node.iterator, time: getTime(value) ?? node.time });
      } else {
        activeIterators.delete(node.iterator);
        if (heap.isEmpty() && nextSourceIndex < sourcesWithTime.length) {
          // Heap is empty but timed sources remain; activate the next one.
          await activateNextSource();
        }
      }
    }
  } finally {
    // Close every iterator that is still active — this includes any left in the heap AND the
    // one whose value was mid-yield when the consumer cancelled (that node was already popped
    // from the heap by `pop()` before `yield`, so it would otherwise be skipped here, leaking
    // any resources it holds open — e.g. a pinned HydratedSourcePool entry in McapIterableSource).
    await Promise.allSettled(
      [...activeIterators].map(async (iterator) => {
        await iterator.return?.();
      }),
    );
  }
}

/** Undefined for an alert, which has no time of its own */
function getTime(event: IteratorResult): bigint | undefined {
  if (event.type === "message-event") {
    return toNanoSec(event.msgEvent.receiveTime);
  }
  if (event.type === "stamp") {
    return toNanoSec(event.stamp);
  }
  return undefined;
}
