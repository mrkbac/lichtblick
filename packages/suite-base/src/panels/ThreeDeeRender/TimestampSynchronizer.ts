// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { AVLTree } from "@foxglove/avl";
import { toNanoSec, type Time } from "@foxglove/rostime";

import type { MessageEvent } from "@lichtblick/suite";
import { getTimestampForMessage } from "@lichtblick/suite-base/util/time";

/** Stamps older than this behind a topic's newest one are treated as never getting a match. */
export const SYNC_WINDOW_NS = 10_000_000_000n;
/** Bytes buffered per topic while waiting for a match; the oldest stamps go first past it. */
export const SYNC_BYTES_PER_TOPIC = 256 * 1024 * 1024;

/** Messages of one topic by stamp, with their total size. */
type Buffer = { events: AVLTree<bigint, MessageEvent>; bytes: number };

type Stamped = { timestamp?: Partial<Time> };

/**
 * Header stamp, else a `timestamp` field on the message or its first entity, else the
 * log time.
 */
export function syncTimestamp(event: MessageEvent): bigint {
  const message = event.message as (Stamped & { entities?: Stamped[] }) | undefined;
  const timestamp = message?.timestamp ?? message?.entities?.[0]?.timestamp;
  const stamp =
    getTimestampForMessage(message) ??
    (typeof timestamp?.sec === "number" && typeof timestamp.nsec === "number"
      ? (timestamp as Time)
      : undefined) ??
    event.receiveTime;
  return toNanoSec(stamp);
}

/**
 * Holds back messages on the synchronized topics until every one of them has a message with the
 * same timestamp, then releases the newest such set. Other topics pass through unchanged.
 */
export class TimestampSynchronizer {
  #topics: ReadonlySet<string> = new Set();
  #buffers = new Map<string, Buffer>();
  #matched = false;

  /** Topics to synchronize. Fewer than two disables synchronization. */
  public setTopics(topics: ReadonlySet<string>): void {
    if (
      topics.size === this.#topics.size &&
      [...topics].every((topic) => this.#topics.has(topic))
    ) {
      return;
    }
    this.#topics = topics;
    this.clear();
  }

  public clear(): void {
    this.#buffers = new Map();
    this.#matched = false;
  }

  public isActive(): boolean {
    return this.#topics.size >= 2;
  }

  /** True while synchronizing and no matching set has been found since the last reset. */
  public isWaiting(): boolean {
    return this.isActive() && !this.#matched;
  }

  /** Returns the messages to render: unsynchronized ones as is, synchronized ones as a matched set. */
  public filter(events: readonly MessageEvent[]): MessageEvent[] {
    if (!this.isActive()) {
      return events as MessageEvent[];
    }
    const out: MessageEvent[] = [];
    let buffered = false;
    for (const event of events) {
      if (!this.#topics.has(event.topic)) {
        out.push(event);
        continue;
      }
      buffered = true;
      let buffer = this.#buffers.get(event.topic);
      if (!buffer) {
        buffer = { events: new AVLTree((a, b) => (a < b ? -1 : a > b ? 1 : 0)), bytes: 0 };
        this.#buffers.set(event.topic, buffer);
      }
      const stamp = syncTimestamp(event);
      buffer.bytes += event.sizeInBytes - (buffer.events.get(stamp)?.sizeInBytes ?? 0);
      buffer.events.set(stamp, event);
      const cutoff = buffer.events.maxKey()! - SYNC_WINDOW_NS;
      // The newest message always stays, even past the byte budget
      while (
        buffer.events.size > 1 &&
        (buffer.events.minKey()! < cutoff || buffer.bytes > SYNC_BYTES_PER_TOPIC)
      ) {
        buffer.bytes -= buffer.events.shift()![1].sizeInBytes;
      }
    }
    if (buffered) {
      this.#releaseNewestMatch(out);
    }
    return out;
  }

  #releaseNewestMatch(out: MessageEvent[]): void {
    const buffers: Buffer[] = [];
    for (const topic of this.#topics) {
      const buffer = this.#buffers.get(topic);
      if (!buffer) {
        return;
      }
      buffers.push(buffer);
    }
    const [first, ...rest] = buffers;
    // Newest first, so a steady stream matches on its first try
    let entry = first!.events.maxEntry();
    while (entry && !rest.every((buffer) => buffer.events.has(entry![0]))) {
      entry = first!.events.findLessThan(entry[0]);
    }
    if (!entry) {
      return;
    }
    const newest = entry[0];
    for (const buffer of buffers) {
      out.push(buffer.events.get(newest)!);
      while (buffer.events.size > 0 && buffer.events.minKey()! <= newest) {
        buffer.bytes -= buffer.events.shift()![1].sizeInBytes;
      }
    }
    this.#matched = true;
  }
}
