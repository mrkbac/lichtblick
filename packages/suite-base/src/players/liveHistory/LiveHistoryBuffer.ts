// SPDX-License-Identifier: MPL-2.0

import { compare, fromNanoSec, Time, toNanoSec } from "@foxglove/rostime";

import { MessageEvent } from "@lichtblick/suite-base/players/types";

/** Seed key for topics whose messages replace each other as a whole. */
const WHOLE_MESSAGE = "";
const WHOLE_MESSAGE_KEYS: readonly string[] = [WHOLE_MESSAGE];

/**
 * Child frame ids of a transform message (tf2 TFMessage, foxglove FrameTransform(s)), detected by
 * shape so no topic or schema names are involved. Each child frame keeps its own seed, so a frame
 * published rarely on a shared transform topic survives a seek.
 */
export function transformChildFrames(message: unknown): string[] | undefined {
  if (message == undefined || typeof message !== "object") {
    return undefined;
  }
  const msg = message as {
    transforms?: unknown;
    child_frame_id?: unknown;
    parent_frame_id?: unknown;
  };
  if (Array.isArray(msg.transforms)) {
    const frames: string[] = [];
    for (const tf of msg.transforms as { child_frame_id?: unknown }[]) {
      if (typeof tf.child_frame_id !== "string") {
        return undefined;
      }
      frames.push(tf.child_frame_id);
    }
    return frames;
  }
  if (typeof msg.child_frame_id === "string" && typeof msg.parent_frame_id === "string") {
    return [msg.child_frame_id];
  }
  return undefined;
}

/**
 * Rolling history of live messages: everything received during the last `windowNs`, bounded by
 * `maxBytes`. For every topic the last message that fell out of the window is kept as a seed, so
 * latched and rarely published topics (static transforms, maps) are still there after a seek.
 *
 * Messages must be added in receive-time order; a clock that runs backwards needs `clear()`.
 */
export class LiveHistoryBuffer {
  #windowNs: bigint;
  #maxBytes: number;
  #messages: MessageEvent[] = [];
  /** Index of the oldest retained message; dropped entries before it are compacted lazily. */
  #head = 0;
  #bytes = 0;
  /**
   * Per topic and seed key (child frame, or the whole message), the retained messages for that key
   * plus the last one that fell out of the window as its seed. Lets a seek find each key's state
   * with a binary search instead of walking the whole history.
   */
  #index = new Map<string, Map<string, KeyHistory>>();
  /**
   * The history holds every message received since this time: the first trim after `clear()`,
   * advanced by each age cutoff and memory-cap eviction. Enlarging the window can't move it back.
   */
  #completeFromNs?: bigint;
  #capLimited = false;

  public constructor({
    windowNs,
    maxBytes,
  }: {
    windowNs: bigint;
    maxBytes: number;
  }) {
    this.#windowNs = windowNs;
    this.#maxBytes = maxBytes;
  }

  public setWindow(windowNs: bigint): void {
    this.#windowNs = windowNs;
  }

  /** Applies right away, so a lower limit frees memory even before the clock moves on. */
  public setMaxBytes(maxBytes: number): void {
    this.#maxBytes = maxBytes;
    this.trim(undefined);
  }

  public windowNs(): bigint {
    return this.#windowNs;
  }

  public maxBytes(): number {
    return this.#maxBytes;
  }

  public sizeBytes(): number {
    return this.#bytes;
  }

  /** True while the memory cap keeps the history shorter than the window. */
  public capLimited(): boolean {
    return this.#capLimited;
  }

  public size(): number {
    return this.#messages.length - this.#head;
  }

  public add(msg: MessageEvent): void {
    this.#messages.push(msg);
    this.#bytes += msg.sizeInBytes;
    let byKey = this.#index.get(msg.topic);
    if (!byKey) {
      byKey = new Map();
      this.#index.set(msg.topic, byKey);
    }
    for (const key of seedKeys(msg)) {
      let history = byKey.get(key);
      if (!history) {
        history = { messages: [], head: 0, seed: undefined };
        byKey.set(key, history);
      }
      history.messages.push(msg);
    }
    this.trim(msg.receiveTime);
  }

  /**
   * Expire messages older than the window ending at `now`, then enforce the memory cap. Without
   * `now` (no clock yet), only the memory cap is enforced.
   */
  public trim(now: Time | undefined): void {
    let cutoffNs: bigint | undefined;
    if (now != undefined) {
      const nowNs = toNanoSec(now);
      cutoffNs = nowNs - this.#windowNs;
      this.#completeFromNs =
        this.#completeFromNs == undefined
          ? nowNs
          : this.#completeFromNs > cutoffNs
            ? this.#completeFromNs
            : cutoffNs;
    }
    let evictedForTime = false;
    let evictedForCap = false;
    while (this.#head < this.#messages.length) {
      const oldest = this.#messages[this.#head]!;
      if (cutoffNs != undefined && toNanoSec(oldest.receiveTime) < cutoffNs) {
        evictedForTime = true;
      } else if (this.#bytes > this.#maxBytes && this.size() > 1) {
        evictedForCap = true;
        const evictedNs = toNanoSec(oldest.receiveTime) + 1n;
        if (this.#completeFromNs == undefined || evictedNs > this.#completeFromNs) {
          this.#completeFromNs = evictedNs;
        }
      } else {
        break;
      }
      this.#evictOldest();
    }
    if (evictedForCap) {
      this.#capLimited = true;
    } else if (evictedForTime) {
      this.#capLimited = false;
    }
    if (this.#head > 1024 && this.#head * 2 > this.#messages.length) {
      this.#messages = this.#messages.slice(this.#head);
      this.#head = 0;
    }
  }

  /** Start of the seekable range at `now`: the window start, but never before the history is complete. */
  public startTime(now: Time): Time {
    const nowNs = toNanoSec(now);
    let startNs = nowNs - this.#windowNs;
    if (this.#completeFromNs != undefined && this.#completeFromNs > startNs) {
      startNs = this.#completeFromNs;
    }
    if (startNs > nowNs) {
      startNs = nowNs;
    }
    return fromNanoSec(startNs < 0n ? 0n : startNs);
  }

  /** Messages received in (`after`, `upTo`], in order. */
  public range(after: Time, upTo: Time): MessageEvent[] {
    return this.#messages.slice(
      upperBound(this.#messages, this.#head, after),
      upperBound(this.#messages, this.#head, upTo),
    );
  }

  /**
   * Messages received after `last` (a message from this history) up to `upTo`, in order. Messages
   * received at the same time as `last` but added after it are included.
   */
  public rangeAfter(last: MessageEvent, upTo: Time): MessageEvent[] {
    let start = upperBound(this.#messages, this.#head, last.receiveTime);
    for (let i = start - 1; i >= this.#head; i--) {
      const msg = this.#messages[i]!;
      if (msg === last) {
        break;
      }
      if (compare(msg.receiveTime, last.receiveTime) !== 0) {
        break;
      }
      start = i;
    }
    return this.#messages.slice(start, upperBound(this.#messages, this.#head, upTo));
  }

  /**
   * What a panel needs to show the state at `at`: for each topic the last message at or before
   * `at` (for transform topics, the last one per child frame), falling back to the seeds.
   * Returned in receive-time order.
   */
  public backfill(at: Time, topics: ReadonlySet<string>): MessageEvent[] {
    const result = new Set<MessageEvent>(); // one transform message can hold several frames
    for (const topic of topics) {
      for (const history of this.#index.get(topic)?.values() ?? []) {
        const i = upperBound(history.messages, history.head, at);
        const latest = i > history.head ? history.messages[i - 1] : history.seed;
        if (latest) {
          result.add(latest);
        }
      }
    }
    return [...result].sort((a, b) => compare(a.receiveTime, b.receiveTime));
  }

  /**
   * Everything the history holds, in receive-time order: the seeds of topics that fell out of the
   * window, then the retained messages.
   */
  public snapshot(): MessageEvent[] {
    const seeds = new Set<MessageEvent>();
    for (const byKey of this.#index.values()) {
      for (const { seed } of byKey.values()) {
        if (seed) {
          seeds.add(seed);
        }
      }
    }
    return [
      ...[...seeds].sort((a, b) => compare(a.receiveTime, b.receiveTime)),
      ...this.#messages.slice(this.#head),
    ];
  }

  public clear(): void {
    this.#messages = [];
    this.#head = 0;
    this.#bytes = 0;
    this.#index.clear();
    this.#completeFromNs = undefined;
    this.#capLimited = false;
  }

  #evictOldest(): void {
    const msg = this.#messages[this.#head]!;
    this.#messages[this.#head] = undefined as unknown as MessageEvent; // release for GC
    this.#head++;
    this.#bytes -= msg.sizeInBytes;
    const byKey = this.#index.get(msg.topic)!;
    for (const key of seedKeys(msg)) {
      const history = byKey.get(key)!;
      history.messages[history.head] = undefined as unknown as MessageEvent; // release for GC
      history.head++;
      history.seed = msg;
      if (history.head === history.messages.length) {
        history.messages = [];
        history.head = 0;
      } else if (history.head > 1024 && history.head * 2 > history.messages.length) {
        history.messages = history.messages.slice(history.head);
        history.head = 0;
      }
    }
  }
}

type KeyHistory = { messages: MessageEvent[]; head: number; seed: MessageEvent | undefined };

/** Index of the first message from `lo` on received after `time`. */
function upperBound(messages: readonly MessageEvent[], from: number, time: Time): number {
  let lo = from;
  let hi = messages.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compare(messages[mid]!.receiveTime, time) <= 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export function seedKeys(msg: MessageEvent): readonly string[] {
  return transformChildFrames(msg.message) ?? WHOLE_MESSAGE_KEYS;
}

/** Browser JS heap use (fraction of its limit) above which the history gives memory back. */
export const HEAP_HIGH_WATER = 0.85;
/** Heap use below which the history may grow back to its configured limit. */
export const HEAP_LOW_WATER = 0.7;
/** The history never shrinks below this for heap pressure. */
export const HEAP_MIN_HISTORY_BYTES = 16 * 1024 * 1024;

export type HeapUsage = { usedJSHeapSize: number; jsHeapSizeLimit: number };

/**
 * Memory limit to impose on the history because the whole tab is close to running out of heap,
 * or undefined for none. Shrinks the history by a quarter each time the heap is above the high
 * water mark, and lifts the limit once it falls below the low water mark.
 */
export function heapLimitBytes(
  heap: HeapUsage | undefined,
  historyBytes: number,
  currentLimit: number | undefined,
): number | undefined {
  if (!heap || heap.jsHeapSizeLimit <= 0) {
    return undefined;
  }
  const used = heap.usedJSHeapSize / heap.jsHeapSizeLimit;
  if (used > HEAP_HIGH_WATER) {
    const shrunk = Math.max(HEAP_MIN_HISTORY_BYTES, Math.floor(historyBytes * 0.75));
    return Math.min(shrunk, currentLimit ?? Number.POSITIVE_INFINITY);
  }
  return used < HEAP_LOW_WATER ? undefined : currentLimit;
}
