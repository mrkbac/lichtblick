// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import PlayerAlertManager from "@lichtblick/suite-base/players/PlayerAlertManager";
import { seedKeys } from "@lichtblick/suite-base/players/liveHistory/LiveHistoryBuffer";
import { MessageEvent } from "@lichtblick/suite-base/players/types";

/**
 * Default cap for messages waiting to be emitted by a live player. A hidden tab throttles timers to
 * about once per second (or less), so messages pile up between emits; without a cap a busy
 * connection grows the heap by gigabytes per minute.
 */
export const LIVE_QUEUE_MAX_BYTES = 400 * 1024 * 1024;

export const LIVE_QUEUE_FULL_ALERT_ID = "liveQueue:full";

/**
 * Messages a live player received but has not emitted yet. The byte cap is required: when it is
 * exceeded the oldest messages are dropped (down to 80% of the cap, so the cost is amortized),
 * except the latest one per topic and transform child frame, and an alert is raised on the
 * player's alert manager.
 *
 * Every live player must buffer through this class instead of a bare array.
 */
export class LiveMessageQueue {
  readonly #maxBytes: number;
  readonly #alerts: PlayerAlertManager;
  #messages: MessageEvent[] = [];
  #bytes = 0;

  public constructor(maxBytes: number, alerts: PlayerAlertManager) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      throw new Error(`LiveMessageQueue needs a finite positive byte cap, got ${maxBytes}`);
    }
    this.#maxBytes = maxBytes;
    this.#alerts = alerts;
  }

  public length(): number {
    return this.#messages.length;
  }

  public sizeInBytes(): number {
    return this.#bytes;
  }

  public push(msg: MessageEvent): void {
    this.#messages.push(msg);
    this.#bytes += msg.sizeInBytes;
    if (this.#bytes > this.#maxBytes) {
      this.#dropOldest();
    }
  }

  /** Remove and return every queued message, oldest first. */
  public drain(): MessageEvent[] {
    const messages = this.#messages;
    this.clear();
    return messages;
  }

  public clear(): void {
    this.#messages = [];
    this.#bytes = 0;
  }

  #dropOldest(): void {
    // The newest message of each topic (each child frame for transforms) is never dropped, so a
    // one-shot static transform or map isn't lost for good while the tab is in the background.
    const latest = new Set<MessageEvent>();
    const seen = new Set<string>();
    for (let i = this.#messages.length - 1; i >= 0; i--) {
      const msg = this.#messages[i]!;
      for (const key of seedKeys(msg)) {
        const id = `${msg.topic}\0${key}`;
        if (!seen.has(id)) {
          seen.add(id);
          latest.add(msg);
        }
      }
    }
    const target = 0.8 * this.#maxBytes;
    const kept: MessageEvent[] = [];
    let bytes = this.#bytes;
    let count = 0;
    for (; count < this.#messages.length && bytes > target; count++) {
      const msg = this.#messages[count]!;
      if (latest.has(msg)) {
        kept.push(msg);
      } else {
        bytes -= msg.sizeInBytes;
      }
    }
    if (bytes > this.#maxBytes) {
      // The latest message per key alone exceeds the cap: drop the oldest regardless.
      kept.length = 0;
      bytes = this.#bytes;
      for (count = 0; count < this.#messages.length && bytes > target; count++) {
        bytes -= this.#messages[count]!.sizeInBytes;
      }
    }
    this.#bytes = bytes;
    this.#messages = kept.concat(this.#messages.slice(count));
    this.#alerts.addAlert(LIVE_QUEUE_FULL_ALERT_ID, {
      severity: "warn",
      message: `Dropped messages: more than ${(this.#maxBytes / 1_000_000).toFixed(0)} MB were waiting to be shown.`,
      tip: "This happens when the tab is in the background or the app can't keep up with the data rate.",
    });
  }
}
