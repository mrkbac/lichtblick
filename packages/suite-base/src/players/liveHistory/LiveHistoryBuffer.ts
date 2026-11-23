// SPDX-License-Identifier: MPL-2.0

import { compare, fromNanoSec, Time, toNanoSec } from "@foxglove/rostime";

import { MessageEvent } from "@lichtblick/suite-base/players/types";

/** Seed key for topics whose messages replace each other as a whole. */
const WHOLE_MESSAGE = "";
const WHOLE_MESSAGE_KEYS: readonly string[] = [WHOLE_MESSAGE];

/** Messages between seek checkpoints; a seek reads at most this many messages once they exist. */
export const CHECKPOINT_INTERVAL = 8192;

/**
 * The transforms of a transform message, each with a string `child_frame_id`, without copying the
 * message's array; undefined for other messages.
 */
export function transformEntries(
  message: unknown,
): readonly { child_frame_id: string }[] | undefined {
  if (message == undefined || typeof message !== "object") {
    return undefined;
  }
  const msg = message as {
    transforms?: unknown;
    child_frame_id?: unknown;
    parent_frame_id?: unknown;
  };
  if (Array.isArray(msg.transforms)) {
    const transforms = msg.transforms as unknown[];
    for (const tf of transforms) {
      if (
        tf == undefined ||
        typeof tf !== "object" ||
        typeof (tf as { child_frame_id?: unknown }).child_frame_id !== "string"
      ) {
        return undefined;
      }
    }
    return transforms as { child_frame_id: string }[];
  }
  if (typeof msg.child_frame_id === "string" && typeof msg.parent_frame_id === "string") {
    return [msg as { child_frame_id: string }];
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
  /** Per topic and seed key, the last evicted message and its sequence number. */
  #seeds = new Map<string, Map<string, Seed>>();
  /** Sequence number of the message at `#head`: how many messages were ever evicted. */
  #headSeq = 0;
  /**
   * For block `b`, the sequence number of the latest message before `b * CHECKPOINT_INTERVAL` per
   * topic and seed key. Built by seeks, on demand, so adding messages costs nothing extra.
   */
  #checkpoints = new Map<number, Checkpoint>();
  /** Once `#headSeq` reaches this, the oldest checkpoint is stale. */
  #checkpointsValidFrom = Infinity;
  /** Messages added before the last seek; seeks in quick succession (scrubbing) use checkpoints. */
  #lastSeekSeq = -Infinity;
  /** After a checkpoint grew too big (many distinct keys), none are built until this is evicted. */
  #noCheckpointsBeforeSeq = 0;
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
    if (this.#headSeq >= this.#checkpointsValidFrom) {
      this.#dropStaleCheckpoints();
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
    return this.#messages.slice(this.#upperBound(after), this.#upperBound(upTo));
  }

  /**
   * Messages received after `last` (a message from this history) up to `upTo`, in order. Messages
   * received at the same time as `last` but added after it are included.
   */
  public rangeAfter(last: MessageEvent, upTo: Time): MessageEvent[] {
    let start = this.#upperBound(last.receiveTime);
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
    return this.#messages.slice(start, this.#upperBound(upTo));
  }

  /**
   * What a panel needs to show the state at `at`: for each topic the last message at or before
   * `at` (for transform topics, the last one per child frame), falling back to the seeds.
   * Returned in receive-time order.
   */
  public backfill(at: Time, topics: ReadonlySet<string>): MessageEvent[] {
    const found = new Map<string, Set<string>>();
    const result = new Map<MessageEvent, number>(); // with its sequence number, to order ties
    // Topics whose whole-message state is found; transform topics never are, as frames vary.
    let complete = 0;
    const take = (msg: MessageEvent, seq: number, keys: readonly string[]) => {
      let seen = found.get(msg.topic);
      if (!seen) {
        seen = new Set();
        found.set(msg.topic, seen);
      }
      let isNew = false;
      for (const key of keys) {
        if (!seen.has(key)) {
          seen.add(key);
          isNew = true;
          if (key === WHOLE_MESSAGE) {
            complete++;
          }
        }
      }
      if (isNew) {
        result.set(msg, seq);
      }
    };
    // Walking back to the oldest message is what a transform or silent topic costs. While scrubbing,
    // walk back only to the block start and take what's still missing from its checkpoint, which
    // costs at most that same walk to bring up to date. A lone seek walks as before, so checkpoints
    // are only built when later seeks will reuse them.
    const end = this.#upperBound(at);
    // The block of the last message at or before `at`, so a seek at a block boundary walks the
    // block that ends there instead of the empty one after it.
    const block = Math.floor(Math.max(this.#seqOf(end) - 1, 0) / CHECKPOINT_INTERVAL);
    const blockStart = this.#indexOf(block * CHECKPOINT_INTERVAL);
    const added = this.#seqOf(this.#messages.length);
    const scrubbing = added - this.#lastSeekSeq < CHECKPOINT_INTERVAL;
    this.#lastSeekSeq = added;
    const walk = (from: number, to: number) => {
      for (let i = from - 1; i >= to && complete < topics.size; i--) {
        const msg = this.#messages[i]!;
        if (topics.has(msg.topic) && found.get(msg.topic)?.has(WHOLE_MESSAGE) !== true) {
          take(msg, this.#seqOf(i), seedKeys(msg));
        }
      }
    };
    const useCheckpoint =
      scrubbing && blockStart > this.#head && this.#headSeq >= this.#noCheckpointsBeforeSeq;
    // The current block first: if it has everything, no checkpoint is needed.
    walk(end, useCheckpoint ? blockStart : this.#head);
    const checkpoint =
      useCheckpoint && complete < topics.size ? this.#checkpoint(block) : undefined;
    if (useCheckpoint && complete < topics.size && !checkpoint) {
      walk(blockStart, this.#head);
    }
    if (checkpoint && complete < topics.size) {
      // Entries older than the oldest message were evicted; the seed for their key is that message.
      const takeRetained = (seq: number | undefined, keys: readonly string[], topic: string) => {
        if (
          seq != undefined &&
          seq >= this.#headSeq &&
          found.get(topic)?.has(WHOLE_MESSAGE) !== true
        ) {
          take(this.#messages[this.#indexOf(seq)]!, seq, keys);
        }
      };
      for (const topic of topics) {
        // Newest first, as the walk does: on a topic with both plain and transform messages, a
        // whole message hides only older frames.
        const entries: [number | undefined, readonly string[]][] = [
          [checkpoint.whole.get(topic), WHOLE_MESSAGE_KEYS],
        ];
        for (const [key, seq] of checkpoint.frames.get(topic) ?? []) {
          entries.push([seq, [key]]);
        }
        entries.sort(([a], [b]) => (b ?? -1) - (a ?? -1));
        for (const [seq, keys] of entries) {
          takeRetained(seq, keys, topic);
        }
      }
    }
    for (const topic of topics) {
      for (const [key, seed] of this.#seeds.get(topic) ?? []) {
        if (found.get(topic)?.has(WHOLE_MESSAGE) !== true) {
          take(seed.event, seed.seq, [key]);
        }
      }
    }
    return [...result].sort(byTimeThenSeq).map(([msg]) => msg);
  }

  /**
   * Everything the history holds, in receive-time order: the seeds of topics that fell out of the
   * window, then the retained messages.
   */
  public snapshot(): MessageEvent[] {
    const seeds = new Map<MessageEvent, number>();
    for (const byKey of this.#seeds.values()) {
      for (const { event, seq } of byKey.values()) {
        seeds.set(event, seq);
      }
    }
    return [
      ...[...seeds].sort(byTimeThenSeq).map(([event]) => event),
      ...this.#messages.slice(this.#head),
    ];
  }

  public clear(): void {
    this.#messages = [];
    this.#head = 0;
    this.#bytes = 0;
    this.#seeds.clear();
    this.#checkpoints.clear();
    this.#checkpointsValidFrom = Infinity;
    this.#noCheckpointsBeforeSeq = 0;
    this.#completeFromNs = undefined;
    this.#capLimited = false;
  }

  #evictOldest(): void {
    const msg = this.#messages[this.#head]!;
    this.#messages[this.#head] = undefined as unknown as MessageEvent; // release for GC
    const seed: Seed = { event: msg, seq: this.#headSeq };
    this.#head++;
    this.#headSeq++;
    this.#bytes -= msg.sizeInBytes;
    let seeds = this.#seeds.get(msg.topic);
    if (!seeds) {
      seeds = new Map();
      this.#seeds.set(msg.topic, seeds);
    }
    for (const key of seedKeys(msg)) {
      seeds.set(key, seed);
    }
  }

  #dropStaleCheckpoints(): void {
    this.#checkpointsValidFrom = Infinity;
    for (const block of this.#checkpoints.keys()) {
      if (block * CHECKPOINT_INTERVAL <= this.#headSeq) {
        this.#checkpoints.delete(block);
      } else {
        this.#checkpointsValidFrom = Math.min(
          this.#checkpointsValidFrom,
          block * CHECKPOINT_INTERVAL,
        );
      }
    }
  }

  #seqOf(index: number): number {
    return this.#headSeq + (index - this.#head);
  }

  #indexOf(seq: number): number {
    return this.#head + (seq - this.#headSeq);
  }

  /**
   * The checkpoint of `block`, whose start must be a retained message, or undefined if it would
   * hold more keys than a block has messages (then walking is cheaper than keeping it).
   */
  #checkpoint(block: number): Checkpoint | undefined {
    const cached = this.#checkpoints.get(block);
    if (cached) {
      return cached;
    }
    // Continue from the nearest earlier checkpoint, or from the oldest retained message.
    let from = block - 1;
    while (from * CHECKPOINT_INTERVAL > this.#headSeq && !this.#checkpoints.has(from)) {
      from--;
    }
    const base = this.#checkpoints.get(from);
    const start = base ? from * CHECKPOINT_INTERVAL : this.#headSeq;
    const state: Checkpoint = base
      ? cloneCheckpoint(base, this.#headSeq)
      : { whole: new Map<string, number>(), frames: new Map<string, Map<string, number>>() };
    let seq = start;
    for (let b = from + 1; b <= block; b++) {
      for (const end = b * CHECKPOINT_INTERVAL; seq < end; seq++) {
        const msg = this.#messages[this.#indexOf(seq)]!;
        const transforms = transformEntries(msg.message);
        if (transforms == undefined) {
          state.whole.set(msg.topic, seq);
          continue;
        }
        let latest = state.frames.get(msg.topic);
        if (!latest) {
          latest = new Map();
          state.frames.set(msg.topic, latest);
        }
        for (const tf of transforms) {
          latest.set(tf.child_frame_id, seq);
        }
      }
      if (checkpointSize(state) > CHECKPOINT_INTERVAL) {
        this.#noCheckpointsBeforeSeq = this.#seqOf(this.#messages.length);
        return undefined;
      }
      this.#checkpoints.set(b, b === block ? state : cloneCheckpoint(state, this.#headSeq));
      this.#checkpointsValidFrom = Math.min(this.#checkpointsValidFrom, b * CHECKPOINT_INTERVAL);
    }
    return state;
  }

  /** Index of the first retained message received after `time`. */
  #upperBound(time: Time): number {
    let lo = this.#head;
    let hi = this.#messages.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compare(this.#messages[mid]!.receiveTime, time) <= 0) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
}

/**
 * What a later message of the same topic replaces: the child frame ids of a transform message
 * (tf2 TFMessage, foxglove FrameTransform(s)), detected by shape so no topic or schema names are
 * involved, else the whole message. Each child frame keeps its own seed, so a frame published
 * rarely on a shared transform topic survives a seek.
 */
export function seedKeys(msg: MessageEvent): readonly string[] {
  return transformEntries(msg.message)?.map((tf) => tf.child_frame_id) ?? WHOLE_MESSAGE_KEYS;
}

/** Per topic, the sequence number of the latest whole message and of the latest message per frame. */
type Checkpoint = { whole: Map<string, number>; frames: Map<string, Map<string, number>> };

/** Without entries older than `minSeq`: those messages were evicted and are in the seeds. */
function cloneCheckpoint({ whole, frames }: Checkpoint, minSeq: number): Checkpoint {
  const clone: Checkpoint = { whole: new Map(), frames: new Map() };
  for (const [topic, seq] of whole) {
    if (seq >= minSeq) {
      clone.whole.set(topic, seq);
    }
  }
  for (const [topic, latest] of frames) {
    const kept = new Map<string, number>();
    for (const [frame, seq] of latest) {
      if (seq >= minSeq) {
        kept.set(frame, seq);
      }
    }
    if (kept.size > 0) {
      clone.frames.set(topic, kept);
    }
  }
  return clone;
}

function checkpointSize({ whole, frames }: Checkpoint): number {
  let size = whole.size;
  for (const latest of frames.values()) {
    size += latest.size;
  }
  return size;
}

type Seed = { event: MessageEvent; seq: number };

/** Receive-time order, ties in arrival order. */
function byTimeThenSeq(
  [a, aSeq]: [MessageEvent, number],
  [b, bSeq]: [MessageEvent, number],
): number {
  const order = compare(a.receiveTime, b.receiveTime);
  return order !== 0 ? order : aSeq - bSeq;
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
