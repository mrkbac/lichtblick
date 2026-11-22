// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import PlayerAlertManager from "@lichtblick/suite-base/players/PlayerAlertManager";
import { transformEntries } from "@lichtblick/suite-base/players/liveHistory/LiveHistoryBuffer";
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
    const target = 0.8 * this.#maxBytes;
    let bytes = this.#bytes;
    let count = 0;
    while (count < this.#messages.length && bytes > target) {
      bytes -= this.#messages[count]!.sizeInBytes;
      count++;
    }
    // Keep the newest dropped message of each topic (each child frame for transforms), so a one-shot
    // static transform or map isn't lost for good while the tab is in the background. Only the
    // dropped part is scanned; a kept message that a later one replaces goes in the next drop.
    const done = new Set<string>(); // topics whose newest whole message is kept
    const seenFrames = new Map<string, Set<string>>();
    const kept: MessageEvent[] = [];
    let keptBytes = 0;
    for (let i = count - 1; i >= 0; i--) {
      const msg = this.#messages[i]!;
      if (done.has(msg.topic)) {
        continue;
      }
      const transforms = transformEntries(msg.message);
      let isNew = transforms == undefined;
      if (transforms == undefined) {
        done.add(msg.topic);
      } else {
        let seen = seenFrames.get(msg.topic);
        if (!seen) {
          seen = new Set();
          seenFrames.set(msg.topic, seen);
        }
        for (const { child_frame_id: frame } of transforms) {
          if (!seen.has(frame)) {
            seen.add(frame);
            isNew = true;
          }
        }
      }
      if (isNew) {
        kept.push(msg);
        keptBytes += msg.sizeInBytes;
      }
    }
    // Leave headroom, or every push would drop again; without room, drop those too.
    if (bytes + keptBytes <= 0.9 * this.#maxBytes) {
      bytes += keptBytes;
    } else {
      kept.length = 0;
    }
    this.#bytes = bytes;
    this.#messages.splice(0, count, ...kept.reverse());
    this.#alerts.addAlert(LIVE_QUEUE_FULL_ALERT_ID, {
      severity: "warn",
      message: `Dropped messages: more than ${(this.#maxBytes / 1_000_000).toFixed(0)} MB were waiting to be shown.`,
      tip: "This happens when the tab is in the background or the app can't keep up with the data rate.",
    });
  }
}
