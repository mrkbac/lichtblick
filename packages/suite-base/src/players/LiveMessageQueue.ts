// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare } from "@foxglove/rostime";

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
  /** Newest messages per topic and child frame kept by earlier drops; older than `#messages`. */
  #latched: MessageEvent[] = [];
  #bytes = 0;

  public constructor(maxBytes: number, alerts: PlayerAlertManager) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      throw new Error(`LiveMessageQueue needs a finite positive byte cap, got ${maxBytes}`);
    }
    this.#maxBytes = maxBytes;
    this.#alerts = alerts;
  }

  public length(): number {
    return this.#latched.length + this.#messages.length;
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
    const messages =
      this.#latched.length > 0 ? this.#latched.concat(this.#messages) : this.#messages;
    this.clear();
    return messages;
  }

  public clear(): void {
    this.#messages = [];
    this.#latched = [];
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
    // Keep the newest dropped message of each topic (each child frame for transforms) unless one
    // still queued replaces it, so a one-shot static transform or map isn't lost for good while
    // the tab is in the background. Kept messages move to `#latched`: later drops only check
    // them against newer dropped messages, so a key that never comes back is searched for once.
    const claimed = new Map<string, Set<string>>(); // per topic: child frames, or "" for the topic
    const candidates: Candidate[] = [];
    const consider = (msg: MessageEvent, source: "queue" | "latched") => {
      let topicKeys = claimed.get(msg.topic);
      if (topicKeys?.has("") === true) {
        return; // a newer whole message of this topic is already kept
      }
      if (!topicKeys) {
        topicKeys = new Set();
        claimed.set(msg.topic, topicKeys);
      }
      const transforms = transformEntries(msg.message);
      let keys: string[] | undefined;
      if (transforms == undefined) {
        topicKeys.add("");
        keys = [""];
      } else {
        for (const { child_frame_id: frame } of transforms) {
          if (!topicKeys.has(frame)) {
            topicKeys.add(frame);
            (keys ??= []).push(frame);
          }
        }
      }
      if (keys) {
        candidates.push({
          msg,
          keys,
          transform: transforms != undefined,
          latched: source === "latched",
        });
      }
    };
    for (let i = count - 1; i >= 0; i--) {
      consider(this.#messages[i]!, "queue");
    }
    for (let i = this.#latched.length - 1; i >= 0; i--) {
      bytes -= this.#latched[i]!.sizeInBytes;
      consider(this.#latched[i]!, "latched");
    }
    const pending = new Map<string, Set<string>>();
    for (const { msg, keys, latched } of candidates) {
      if (!latched) {
        const topicKeys = pending.get(msg.topic) ?? new Set();
        pending.set(msg.topic, topicKeys);
        keys.forEach((key) => topicKeys.add(key));
      }
    }
    // Stops once every key turned up again.
    for (let i = count; i < this.#messages.length && pending.size > 0; i++) {
      const msg = this.#messages[i]!;
      const topicKeys = pending.get(msg.topic);
      if (!topicKeys) {
        continue;
      }
      for (const key of transformEntries(msg.message)?.map((tf) => tf.child_frame_id) ?? [""]) {
        topicKeys.delete(key);
      }
      if (topicKeys.size === 0) {
        pending.delete(msg.topic);
      }
    }
    // Within the headroom left under the cap (so the next push doesn't drop again), transforms
    // first, then the smallest messages.
    const wanted = candidates
      .filter(
        ({ msg, keys, latched }) =>
          latched || keys.some((key) => pending.get(msg.topic)?.has(key) === true),
      )
      .sort((a, b) =>
        a.transform === b.transform
          ? a.msg.sizeInBytes - b.msg.sizeInBytes
          : Number(b.transform) - Number(a.transform),
      );
    const kept: MessageEvent[] = [];
    for (const { msg } of wanted) {
      if (bytes + msg.sizeInBytes <= 0.9 * this.#maxBytes) {
        bytes += msg.sizeInBytes;
        kept.push(msg);
      }
    }
    this.#latched = kept.sort((a, b) => compare(a.receiveTime, b.receiveTime));
    this.#bytes = bytes;
    this.#messages.splice(0, count);
    this.#alerts.addAlert(LIVE_QUEUE_FULL_ALERT_ID, {
      severity: "warn",
      message: `Dropped messages: more than ${(this.#maxBytes / 1_000_000).toFixed(0)} MB were waiting to be shown.`,
      tip: "This happens when the tab is in the background or the app can't keep up with the data rate.",
    });
  }
}

type Candidate = { msg: MessageEvent; keys: string[]; transform: boolean; latched: boolean };
