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
    // Kept messages are chosen again below. The queued ones make room for them, but never below
    // half the target, so large kept messages can't empty the queue on every drop.
    let bytes = this.#bytes;
    let latchedBytes = 0;
    for (const msg of this.#latched) {
      latchedBytes += msg.sizeInBytes;
    }
    bytes -= latchedBytes;
    const target = Math.max(0.8 * this.#maxBytes - latchedBytes, 0.4 * this.#maxBytes);
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
    // Kept messages arrived before every queued one.
    const consider = (msg: MessageEvent, source: "queue" | "latched", arrival: number) => {
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
          arrival,
        });
      }
    };
    for (let i = count - 1; i >= 0; i--) {
      consider(this.#messages[i]!, "queue", this.#latched.length + i);
    }
    for (let i = this.#latched.length - 1; i >= 0; i--) {
      consider(this.#latched[i]!, "latched", i);
    }
    // Drop candidates that a still queued message replaces. Latched ones are only checked when they
    // don't all fit, since a key that never comes back (a static transform) means a full scan.
    let wanted = this.#unreplaced(candidates, count, ({ latched }) => !latched);
    const limit = 0.9 * this.#maxBytes;
    let kept = selectWithin(wanted, bytes, limit);
    let messages = this.#messages.slice(count);
    if (kept.length < wanted.length) {
      wanted = this.#unreplaced(wanted, count, ({ latched }) => latched);
      // Still short: reclaim queued messages that a newer queued one replaces, oldest first. They
      // only repeat older values, so they go before a kept message that has no newer copy.
      const short = wanted.reduce((sum, { msg }) => sum + msg.sizeInBytes, bytes) - limit;
      if (short > 0) {
        const reclaim = replacedWithin(messages, short);
        messages = messages.filter((msg) => !reclaim.has(msg));
        reclaim.forEach((msg) => (bytes -= msg.sizeInBytes));
      }
      kept = selectWithin(wanted, bytes, limit);
    }
    // Arrival order, not receive time: a clock reset must not put an older value last.
    this.#latched = kept.sort((a, b) => a.arrival - b.arrival).map(({ msg }) => msg);
    this.#messages = messages;
    this.#bytes = kept.reduce((sum, { msg }) => sum + msg.sizeInBytes, bytes);
    this.#alerts.addAlert(LIVE_QUEUE_FULL_ALERT_ID, {
      severity: "warn",
      message: `Dropped messages: more than ${(this.#maxBytes / 1_000_000).toFixed(0)} MB were waiting to be shown.`,
      tip: "This happens when the tab is in the background or the app can't keep up with the data rate.",
    });
  }

  /**
   * The candidates that no message from `from` on replaces, checking only those that `check`
   * selects. Scans until every checked key turned up again.
   */
  #unreplaced(
    candidates: Candidate[],
    from: number,
    check: (candidate: Candidate) => boolean,
  ): Candidate[] {
    const pending = new Map<string, Set<string>>();
    for (const candidate of candidates) {
      if (check(candidate)) {
        const topicKeys = pending.get(candidate.msg.topic) ?? new Set();
        pending.set(candidate.msg.topic, topicKeys);
        candidate.keys.forEach((key) => topicKeys.add(key));
      }
    }
    for (let i = from; i < this.#messages.length && pending.size > 0; i++) {
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
    return candidates.filter(
      (candidate) =>
        !check(candidate) ||
        candidate.keys.some((key) => pending.get(candidate.msg.topic)?.has(key) === true),
    );
  }
}

type Candidate = {
  msg: MessageEvent;
  keys: string[];
  transform: boolean;
  latched: boolean;
  arrival: number;
};

/**
 * Transforms first, then the smallest, as many as fit with `bytes` already used under `limit`
 * (headroom, so the next push doesn't drop again).
 */
function selectWithin(candidates: readonly Candidate[], bytes: number, limit: number): Candidate[] {
  const kept: Candidate[] = [];
  let total = bytes;
  const byPriority = [...candidates].sort((a, b) =>
    a.transform === b.transform
      ? a.msg.sizeInBytes - b.msg.sizeInBytes
      : Number(b.transform) - Number(a.transform),
  );
  for (const candidate of byPriority) {
    if (total + candidate.msg.sizeInBytes <= limit) {
      total += candidate.msg.sizeInBytes;
      kept.push(candidate);
    }
  }
  return kept;
}

/**
 * Messages, oldest first, that a later message of the same topic (same child frames for
 * transforms) replaces, until they add up to `bytes`.
 */
function replacedWithin(messages: readonly MessageEvent[], bytes: number): Set<MessageEvent> {
  const seen = new Map<string, Set<string>>();
  const replaced: MessageEvent[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    let topicKeys = seen.get(msg.topic);
    if (!topicKeys) {
      topicKeys = new Set();
      seen.set(msg.topic, topicKeys);
    }
    let isReplaced = true;
    for (const key of transformEntries(msg.message)?.map((tf) => tf.child_frame_id) ?? [""]) {
      if (!topicKeys.has(key)) {
        topicKeys.add(key);
        isReplaced = false;
      }
    }
    if (isReplaced) {
      replaced.push(msg);
    }
  }
  const reclaim = new Set<MessageEvent>();
  let freed = 0;
  for (let i = replaced.length - 1; i >= 0 && freed < bytes; i--) {
    reclaim.add(replaced[i]!);
    freed += replaced[i]!.sizeInBytes;
  }
  return reclaim;
}
