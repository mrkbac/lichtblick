// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { toNanoSec, type Time } from "@foxglove/rostime";

import type { MessageEvent } from "@lichtblick/suite";
import { getTimestampForMessage } from "@lichtblick/suite-base/util/time";

/** Unique timestamps buffered per topic while waiting for a match (~10 s at 25 Hz). */
export const MAX_SYNC_STAMPS_PER_TOPIC = 250;

type Stamped = { timestamp?: Partial<Time> };

/**
 * Header stamp (ROS), `timestamp` field or first entity's `timestamp` (foxglove schemas), else the
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
  #buffers = new Map<string, Map<bigint, MessageEvent>>();
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
        buffer = new Map();
        this.#buffers.set(event.topic, buffer);
      }
      buffer.set(syncTimestamp(event), event);
      if (buffer.size > MAX_SYNC_STAMPS_PER_TOPIC) {
        let oldest: bigint | undefined;
        for (const stamp of buffer.keys()) {
          if (oldest == undefined || stamp < oldest) {
            oldest = stamp;
          }
        }
        buffer.delete(oldest!);
      }
    }
    if (buffered) {
      this.#releaseNewestMatch(out);
    }
    return out;
  }

  #releaseNewestMatch(out: MessageEvent[]): void {
    const buffers = [...this.#topics].map((topic) => this.#buffers.get(topic));
    if (buffers.some((buffer) => buffer == undefined)) {
      return;
    }
    const [first, ...rest] = buffers as Map<bigint, MessageEvent>[];
    let newest: bigint | undefined;
    for (const stamp of first!.keys()) {
      if ((newest == undefined || stamp > newest) && rest.every((buffer) => buffer.has(stamp))) {
        newest = stamp;
      }
    }
    if (newest == undefined) {
      return;
    }
    for (const buffer of buffers as Map<bigint, MessageEvent>[]) {
      out.push(buffer.get(newest)!);
      for (const stamp of buffer.keys()) {
        if (stamp <= newest) {
          buffer.delete(stamp);
        }
      }
    }
    this.#matched = true;
  }
}
