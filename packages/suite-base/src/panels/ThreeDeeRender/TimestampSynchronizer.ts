// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { AVLTree } from "@foxglove/avl";
import { toNanoSec, type Time } from "@foxglove/rostime";

import type { MessageEvent } from "@lichtblick/suite";
import { getTimestampForMessage, stampToTime } from "@lichtblick/suite-base/util/time";

/** Stamps this far behind a topic's latest received one are treated as never getting a match. */
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
  const stamp = getTimestampForMessage(message) ?? stampToTime(timestamp) ?? event.receiveTime;
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
    // A set can only complete at a stamp inserted now: older complete ones were already released
    let newest: bigint | undefined;
    // Earlier candidates of this batch, only needed if eviction removes a part of `newest`
    let older: bigint[] | undefined;
    let evicted = false;
    for (const event of events) {
      if (!this.#topics.has(event.topic)) {
        out.push(event);
        continue;
      }
      let buffer = this.#buffers.get(event.topic);
      if (!buffer) {
        buffer = { events: new AVLTree((a, b) => (a < b ? -1 : a > b ? 1 : 0)), bytes: 0 };
        this.#buffers.set(event.topic, buffer);
      }
      const stamp = syncTimestamp(event);
      buffer.bytes += event.sizeInBytes - (buffer.events.get(stamp)?.sizeInBytes ?? 0);
      buffer.events.set(stamp, event);
      if (this.#allHave(stamp)) {
        if (newest == undefined) {
          newest = stamp;
        } else if (stamp > newest) {
          (older ??= []).push(newest);
          newest = stamp;
        } else if (stamp < newest) {
          (older ??= []).push(stamp);
        }
      }
      // From this message, not the buffer's max: one future-stamped message must not evict the rest
      const cutoff = stamp - SYNC_WINDOW_NS;
      // The newest message always stays, even past the byte budget
      while (
        buffer.events.size > 1 &&
        (buffer.events.minKey()! < cutoff || buffer.bytes > SYNC_BYTES_PER_TOPIC)
      ) {
        buffer.bytes -= buffer.events.shift()![1].sizeInBytes;
        evicted = true;
      }
    }
    if (evicted && newest != undefined && !this.#allHave(newest)) {
      // A later message in the batch evicted part of it: take the newest still complete
      const candidates = older ?? [];
      newest = undefined;
      for (const stamp of candidates) {
        if ((newest == undefined || stamp > newest) && this.#allHave(stamp)) {
          newest = stamp;
        }
      }
    }
    if (newest != undefined) {
      this.#release(newest, out);
    }
    return out;
  }

  #allHave(stamp: bigint): boolean {
    for (const topic of this.#topics) {
      if (this.#buffers.get(topic)?.events.has(stamp) !== true) {
        return false;
      }
    }
    return true;
  }

  /** Releases the set at `stamp` and drops everything older */
  #release(stamp: bigint, out: MessageEvent[]): void {
    for (const topic of this.#topics) {
      const buffer = this.#buffers.get(topic)!;
      out.push(buffer.events.get(stamp)!);
      while (buffer.events.size > 0 && buffer.events.minKey()! <= stamp) {
        buffer.bytes -= buffer.events.shift()![1].sizeInBytes;
      }
    }
    this.#matched = true;
  }
}
