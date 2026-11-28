// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare, fromNanoSec, Time, toNanoSec } from "@foxglove/rostime";

import { VecQueue } from "@lichtblick/den/collection";
import { TopicSelection } from "@lichtblick/suite-base/players/types";
import { toError } from "@lichtblick/suite-base/util/toError";

import { IteratorResult as ReadResult } from "./IIterableSource";

type Range = { start?: Time; end?: Time };

/** The recording's bounds and the playhead, where a playhead-first pass starts */
type Playhead = { start: Time; end: Time; playhead: Time };

type ReadRange = (
  topics: TopicSelection,
  range: Range,
  signal: AbortSignal,
) => AsyncIterableIterator<Readonly<ReadResult>>;

/** Bytes of messages one reader may have waiting before the shared read waits for it */
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;

/** How long a range read waits for others over the same range to join it */
const GATHER_MS = 10;

/** Smallest window a pass reads */
const MIN_WINDOW_NS = 20_000_000_000n;

/** Windows of an ascending pass: the boundaries where a reader that starts later joins it */
const ASCENDING_WINDOWS = 32n;

/** Inclusive spans in nanoseconds as ranges; spans reaching `first` or `last` are open there */
function toRanges(spans: [bigint, bigint][], first: bigint, last: bigint): Range[] {
  return spans.map(([from, to]) => ({
    start: from <= first ? undefined : fromNanoSec(from),
    end: to >= last ? undefined : fromNanoSec(to),
  }));
}

/**
 * Spans that grow [lo, hi] (read already) to [first, last]: alternately the span before and the
 * one after, each side's spans doubling from `size`
 */
function growSpans(
  first: bigint,
  last: bigint,
  lo: bigint,
  hi: bigint,
  size: bigint,
): [bigint, bigint][] {
  const clamp = (ns: bigint) => (ns < first ? first : ns > last ? last : ns);
  const spans: [bigint, bigint][] = [];
  while (lo > first || hi < last) {
    if (lo > first) {
      const to = lo - 1n;
      lo = clamp(to - size + 1n);
      spans.push([lo, to]);
    }
    if (hi < last) {
      const from = hi + 1n;
      hi = clamp(from + size - 1n);
      spans.push([from, hi]);
    }
    size *= 2n;
  }
  return spans;
}

/** Size of a pass's first window: max(20 s, 1/32 of the recording) */
function windowSize(first: bigint, last: bigint): bigint {
  const size = (last - first) / 32n;
  return size < MIN_WINDOW_NS ? MIN_WINDOW_NS : size;
}

/**
 * The windows a playhead-first pass reads, in order: one around the playhead (max(20 s, 1/32 of the
 * recording)), then alternately the window before what was read and the one after it, each side's
 * windows doubling, until they reach the recording's start and end. Together they cover the
 * recording exactly once; ends are inclusive. The first and last windows are open (no start or
 * end), so nothing before or after the bounds known now is missed.
 */
export function playheadWindows({ start, end, playhead }: Playhead): Range[] {
  const first = toNanoSec(start);
  const last = toNanoSec(end);
  if (last <= first) {
    return [{}];
  }
  const size = windowSize(first, last);
  const at = toNanoSec(playhead);
  const clamp = (ns: bigint) => (ns < first ? first : ns > last ? last : ns);
  const lo = clamp(at - size / 2n);
  const hi = clamp(at + size / 2n);
  return toRanges([[lo, hi], ...growSpans(first, last, lo, hi, size)], first, last);
}

/**
 * After a seek out of [lo, hi] (read already, contiguous): the window from there to the playhead
 * (and half a window past it), then windows growing the read span as playheadWindows does. Readers
 * still get each window entirely before or after everything delivered before it. Undefined when
 * the playhead is inside [lo, hi].
 */
export function windowsAfterSeek(
  { start, end, playhead }: Playhead,
  lo: bigint,
  hi: bigint,
  size: bigint,
): Range[] | undefined {
  const first = toNanoSec(start);
  const last = toNanoSec(end);
  const clamp = (ns: bigint) => (ns < first ? first : ns > last ? last : ns);
  const at = clamp(toNanoSec(playhead));
  if (at >= lo && at <= hi) {
    return undefined;
  }
  const next: [bigint, bigint] =
    at > hi ? [hi + 1n, clamp(at + size / 2n)] : [clamp(at - size / 2n), lo - 1n];
  const spans = growSpans(
    first,
    last,
    next[0] < lo ? next[0] : lo,
    next[1] > hi ? next[1] : hi,
    size,
  );
  return toRanges([next, ...spans], first, last);
}

/** The windows an ascending pass reads: the recording in equal windows, in time order */
function ascendingWindows({ start, end }: Playhead): Range[] {
  const first = toNanoSec(start);
  const last = toNanoSec(end);
  if (last <= first) {
    return [{}];
  }
  let size = (last - first + 1n) / ASCENDING_WINDOWS;
  if (size < MIN_WINDOW_NS) {
    size = MIN_WINDOW_NS;
  }
  const spans: [bigint, bigint][] = [];
  for (let from = first; from <= last; from += size) {
    const to = from + size - 1n;
    spans.push([from, to < last ? to : last]);
  }
  return toRanges(spans, first, last);
}

/** Reads `windows` one after another */
function readWindows(
  readRange: ReadRange,
  topic: string,
  windows: readonly Range[],
  signal: AbortSignal,
): AsyncIterableIterator<Readonly<ReadResult>> {
  const topics = new Map([[topic, { topic }]]);
  if (windows.length === 1) {
    // Opened now: an error opening it reaches the caller right away
    return readRange(topics, windows[0]!, signal);
  }
  return (async function* () {
    for (const span of windows) {
      if (signal.aborted) {
        return;
      }
      yield* readRange(topics, span, signal);
    }
  })();
}

/**
 * Reads of single topics' whole history (Plot, Log, Map…) share one read of all their topics: one
 * pass over the recording instead of one per topic, so a chunk is read and decompressed once and a
 * message two panels want is decoded once. A pass reads the recording window by window. Reads that
 * start at about the same time gather into a new pass. A read that starts while a pass is running
 * joins it at the next window: it first gets the windows it missed (read for all readers joining
 * at that window together), then the pass's windows. Reads of part of the recording (e.g. stepping
 * to the next message) start right away on their own.
 *
 * A playhead-first read gets the history around the playhead first, then window by window earlier
 * and later history (see playheadWindows): each window in time order, and each window entirely
 * before or entirely after everything delivered before it. After a seek, the next window reaches
 * the new playhead (see windowsAfterSeek). Playhead-first and ascending reads gather in separate
 * passes: an ascending reader in a playhead-first pass would have to hold everything read before
 * the recording's start comes, about the whole topic.
 */
export class SharedRangeReads {
  readonly #readRange: ReadRange;
  readonly #playhead: () => Playhead | undefined;
  /** Per order, the shared read still gathering readers */
  readonly #gathering = new Map<boolean, SharedRead>();
  /** Per order, the shared read running now, which a new whole-history read joins */
  readonly #running = new Map<boolean, SharedRead>();

  public constructor(readRange: ReadRange, playhead: () => Playhead | undefined = () => undefined) {
    this.#readRange = readRange;
    this.#playhead = playhead;
  }

  public read(
    topic: string,
    range: Range,
    { playheadFirst = false }: { playheadFirst?: boolean } = {},
  ): AsyncIterableIterator<Readonly<ReadResult>> {
    if (range.start || range.end) {
      const abort = new AbortController();
      const reader = new Reader(
        topic,
        () => {},
        () => {},
      );
      reader.detach(this.#readRange(new Map([[topic, { topic }]]), range, abort.signal), 0, abort);
      return reader;
    }
    // Joins a shared read on its first pull: an iterator that is never read can't hold up others
    let reader: Reader | undefined;
    let closed = false;
    const order = playheadFirst;
    const join = () => {
      const gathering = this.#gathering.get(order);
      if (gathering) {
        return gathering.join(topic);
      }
      const running = this.#running.get(order);
      if (running?.isJoinable() === true) {
        return running.joinLate(topic);
      }
      // The playhead as it is when the pass starts
      const plan = () => {
        const playhead = this.#playhead();
        if (!playhead) {
          return [range];
        }
        return playheadFirst ? playheadWindows(playhead) : ascendingWindows(playhead);
      };
      const newShared = new SharedRead(
        this.#readRange,
        plan,
        playheadFirst ? this.#playhead : undefined,
      );
      this.#gathering.set(order, newShared);
      setTimeout(() => {
        this.#gathering.delete(order);
        this.#running.set(order, newShared);
        void newShared.run().finally(() => {
          if (this.#running.get(order) === newShared) {
            this.#running.delete(order);
          }
        });
      }, GATHER_MS);
      return newShared.join(topic);
    };
    return {
      next: async () => {
        if (closed) {
          return { done: true, value: undefined };
        }
        reader ??= join();
        return await reader.next();
      },
      return: async () => {
        closed = true;
        await reader?.return();
        return { done: true, value: undefined };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
}

class Reader implements AsyncIterableIterator<Readonly<ReadResult>> {
  public readonly topic: string;
  /** The first of the shared read's windows it gets; it joined later gets the ones before first */
  public fromWindow = 0;
  readonly #queue = new VecQueue<Readonly<ReadResult>>();
  #queuedBytes = 0;
  #ended = false;
  #error?: Error;
  #ready?: PromiseWithResolvers<void>;
  /** Whether its consumer waits for a message */
  public waiting = false;
  /** Its own read, once detached from the shared one */
  #own?: { iterator: AsyncIterator<Readonly<ReadResult>>; abort: AbortController };
  /** Messages of its own read to skip: the shared read delivered them already */
  #skip = 0;
  /** A late joiner's read of the windows before `fromWindow`, delivered first */
  #catchUp?: AsyncIterator<Readonly<ReadResult>>;
  /**
   * Connections with an alert waiting in its queue: further alerts of a connection are dropped
   * until that one is taken, so a failing topic can't fill the queue, and a later error still shows
   */
  readonly #alertQueued = new Set<number>();
  readonly #onPull: () => void;
  readonly #onLeave: (reader: Reader) => void;

  public constructor(topic: string, onPull: () => void, onLeave: (reader: Reader) => void) {
    this.topic = topic;
    this.#onPull = onPull;
    this.#onLeave = onLeave;
  }

  public isFull(): boolean {
    // Progress and zero-byte messages also occupy queue entries.
    return this.#queuedBytes > MAX_QUEUED_BYTES || this.#queue.size() >= 4096;
  }

  public push(result: Readonly<ReadResult>): void {
    // The pass's stamps say nothing about this reader's topic
    if (result.type === "stamp") {
      return;
    }
    if (result.type === "alert") {
      if (this.#alertQueued.has(result.connectionId)) {
        return;
      }
      this.#alertQueued.add(result.connectionId);
    }
    this.waiting = false;
    this.#queue.enqueue(result);
    if (result.type === "message-event") {
      this.#queuedBytes += result.msgEvent.sizeInBytes;
    }
    this.#ready?.resolve();
    this.#ready = undefined;
  }

  public end(error?: unknown): void {
    this.#ended = true;
    this.#error = error == undefined ? undefined : toError(error);
    this.#ready?.resolve();
    this.#ready = undefined;
  }

  /** Delivers `iterator` (the windows before `fromWindow`) before what the shared read pushes */
  public catchUp(iterator: AsyncIterator<Readonly<ReadResult>>): void {
    this.#catchUp = iterator;
  }

  /** Whether it took nothing from the shared read yet: its queue holds all it pushed */
  public tookNothing(): boolean {
    return this.#catchUp != undefined;
  }

  /** Goes on with `own`, skipping its first `skip` messages and dropping what is queued */
  public detach(
    iterator: AsyncIterator<Readonly<ReadResult>>,
    skip: number,
    abort: AbortController,
  ): void {
    this.#queue.clear();
    this.#queuedBytes = 0;
    this.#alertQueued.clear();
    this.#own = { iterator, abort };
    this.#skip = skip;
    this.#ready?.resolve();
    this.#ready = undefined;
  }

  /** Ends the pull waiting on its own read; set only while one waits */
  #cancelPull?: () => void;
  /** The last pull: pulls run one after another, so overlapping ones keep the read's order */
  #lastPull: Promise<unknown> = Promise.resolve();

  public async next(): Promise<IteratorResult<Readonly<ReadResult>>> {
    const pull = this.#lastPull.then(async () => await this.#pull());
    this.#lastPull = pull.catch(() => {});
    return await pull;
  }

  /** The next result of `iterator`, or done right away when the reader is closed meanwhile */
  async #pullFrom(
    iterator: AsyncIterator<Readonly<ReadResult>>,
  ): Promise<IteratorResult<Readonly<ReadResult>>> {
    return await new Promise<IteratorResult<Readonly<ReadResult>>>((resolve, reject) => {
      this.#cancelPull = () => {
        resolve({ done: true, value: undefined });
      };
      iterator.next().then(resolve, reject);
    }).finally(() => {
      this.#cancelPull = undefined;
    });
  }

  async #pull(): Promise<IteratorResult<Readonly<ReadResult>>> {
    // The shared read may end first: the catch-up still delivers what it missed (return() drops it)
    while (this.#catchUp) {
      const result = await this.#pullFrom(this.#catchUp);
      if (result.done !== true) {
        return result;
      }
      this.#catchUp = undefined;
    }
    while (this.#queue.size() === 0 && !this.#ended && !this.#own) {
      this.#ready ??= Promise.withResolvers<void>();
      this.waiting = true;
      // The shared read may wait for room and must know this reader waits for it
      this.#onPull();
      await this.#ready.promise;
      this.waiting = false;
    }
    if (this.#own && this.#queue.size() === 0 && !this.#ended) {
      for (;;) {
        const own = await this.#pullFrom(this.#own.iterator);
        if (own.done === true || own.value.type !== "message-event" || this.#skip === 0) {
          return own;
        }
        this.#skip--;
      }
    }
    const result = this.#queue.dequeue();
    if (result) {
      if (result.type === "message-event") {
        this.#queuedBytes -= result.msgEvent.sizeInBytes;
      } else if (result.type === "alert") {
        this.#alertQueued.delete(result.connectionId);
      }
      this.#onPull();
      return { done: false, value: result };
    }
    if (this.#error) {
      throw this.#error;
    }
    return { done: true, value: undefined };
  }

  public async return(): Promise<IteratorResult<Readonly<ReadResult>>> {
    this.#ended = true;
    this.#cancelPull?.();
    this.#own?.abort.abort();
    // Sources without cancellable I/O may finish closing after their current pull.
    void Promise.resolve(this.#own?.iterator.return?.()).catch(() => {});
    void Promise.resolve(this.#catchUp?.return?.()).catch(() => {});
    this.#catchUp = undefined;
    this.#queue.clear();
    this.#queuedBytes = 0;
    this.#alertQueued.clear();
    this.#onLeave(this);
    this.#ready?.resolve();
    this.#ready = undefined;
    return { done: true, value: undefined };
  }

  public [Symbol.asyncIterator](): this {
    return this;
  }
}

class SharedRead {
  readonly #readRange: ReadRange;
  readonly #plan: () => Range[];
  /** For a playhead-first pass: the playhead, which the windows follow after a seek */
  readonly #playhead?: () => Playhead | undefined;
  /** The windows it reads, in order, and the one it reads now */
  #windows: Range[] = [];
  #windowIndex = 0;
  readonly #readers = new Set<Reader>();
  readonly #abort = new AbortController();
  #running = false;
  #ended = false;
  #pulled?: () => void;
  /** Receive time of the last message read, and per topic how many messages had that time */
  #position?: Time;
  readonly #atPosition = new Map<string, number>();
  /** The catch-up read gathering the readers that join at the next window */
  #catchUp?: { window: number; read: SharedRead };

  public constructor(
    readRange: ReadRange,
    plan: () => Range[],
    playhead?: () => Playhead | undefined,
  ) {
    this.#readRange = readRange;
    this.#plan = plan;
    this.#playhead = playhead;
  }

  /** The windows from `time` (in the current window) on: the current window from there, then the rest */
  #windowsFrom(time: Time | undefined): Range[] {
    const rest = this.#windows.slice(this.#windowIndex + 1);
    if (!time) {
      return this.#windows.slice(this.#windowIndex);
    }
    return [{ start: time, end: this.#windows[this.#windowIndex]?.end }, ...rest];
  }

  public join(topic: string): Reader {
    const reader = new Reader(
      topic,
      () => this.#pulled?.(),
      (left) => {
        this.#readers.delete(left);
        if (this.#running && this.#readers.size === 0) {
          this.#abort.abort();
        }
        this.#pulled?.();
      },
    );
    this.#readers.add(reader);
    return reader;
  }

  /** Whether a new reader can still join: it is running and some reader is left */
  public isJoinable(): boolean {
    return this.#running && !this.#ended && this.#readers.size > 0 && !this.#abort.signal.aborted;
  }

  /**
   * Joins while the read runs: the reader gets the shared read's windows from the next one on, and
   * first the windows up to the current one. Readers joining at the same window read those
   * together, in one catch-up read.
   */
  public joinLate(topic: string): Reader {
    const reader = this.join(topic);
    const window = this.#windowIndex;
    reader.fromWindow = window + 1;
    if (this.#catchUp?.window !== window) {
      const missed = this.#windows.slice(0, window + 1);
      const read = new SharedRead(this.#readRange, () => missed);
      const catchUp = { window, read };
      this.#catchUp = catchUp;
      setTimeout(() => {
        if (this.#catchUp === catchUp) {
          this.#catchUp = undefined;
        }
        void read.run();
      }, GATHER_MS);
    }
    reader.catchUp(this.#catchUp.read.join(topic));
    return reader;
  }

  public async run(): Promise<void> {
    if (this.#readers.size === 0) {
      return;
    }
    this.#windows = this.#plan();
    this.#running = true;
    try {
      for (this.#windowIndex = 0; this.#windowIndex < this.#windows.length; this.#windowIndex++) {
        if (this.#windowIndex > 0) {
          this.#followSeek();
        }
        await this.#runWindow(this.#windows[this.#windowIndex]!);
        if (this.#readers.size === 0 || this.#abort.signal.aborted) {
          break;
        }
      }
      this.#ended = true;
      for (const reader of this.#readers) {
        reader.end();
      }
    } catch (error: unknown) {
      this.#ended = true;
      for (const reader of this.#readers) {
        reader.end(error);
      }
    }
  }

  /** After a seek out of what was read, re-plans the windows left to reach the playhead next */
  #followSeek(): void {
    const now = this.#playhead?.();
    if (!now) {
      return;
    }
    const first = toNanoSec(now.start);
    const last = toNanoSec(now.end);
    let lo = last;
    let hi = first;
    for (const { start, end } of this.#windows.slice(0, this.#windowIndex)) {
      const from = start ? toNanoSec(start) : first;
      const to = end ? toNanoSec(end) : last;
      lo = from < lo ? from : lo;
      hi = to > hi ? to : hi;
    }
    const rest = windowsAfterSeek(now, lo, hi, windowSize(first, last));
    if (rest) {
      this.#windows.splice(this.#windowIndex, Infinity, ...rest);
    }
  }

  /** Reads one window for the readers that get it */
  async #runWindow(span: Range): Promise<void> {
    this.#position = undefined;
    this.#atPosition.clear();
    const window = this.#windowIndex;
    const topics: TopicSelection = new Map(
      [...this.#readers].map((reader) => [reader.topic, { topic: reader.topic }]),
    );
    const onAbort = () => {
      iteration.abort();
    };
    const iteration = new AbortController();
    this.#abort.signal.addEventListener("abort", onAbort);
    try {
      for await (const result of this.#readRange(topics, span, iteration.signal)) {
        if (result.type === "message-event") {
          const { topic, receiveTime } = result.msgEvent;
          if (!this.#position || compare(receiveTime, this.#position) !== 0) {
            this.#position = receiveTime;
            this.#atPosition.clear();
          }
          this.#atPosition.set(topic, (this.#atPosition.get(topic) ?? 0) + 1);
        }
        for (const reader of this.#readers) {
          if (
            reader.fromWindow <= window &&
            (result.type !== "message-event" || result.msgEvent.topic === reader.topic)
          ) {
            reader.push(result);
          }
        }
        // The slowest reader sets the pace, so what waits for it stays bounded. A consumer may
        // wait on one reader before it empties another (e.g. merging inputs by time): readers
        // waiting while the read waits for room go on with their own read instead of blocking
        // each other. So does a late joiner still catching up.
        while (this.#readers.values().some((reader) => reader.isFull())) {
          for (const reader of this.#readers) {
            if (reader.waiting || (reader.tookNothing() && reader.isFull())) {
              this.#detach(reader);
            }
          }
          if (!this.#readers.values().some((reader) => reader.isFull())) {
            break;
          }
          await new Promise<void>((resolve) => {
            this.#pulled = resolve;
          });
          this.#pulled = undefined;
        }
        if (this.#readers.size === 0) {
          break;
        }
      }
    } finally {
      this.#abort.signal.removeEventListener("abort", onAbort);
    }
  }

  /** Continues `reader` with its own read from where the shared read is for it */
  #detach(reader: Reader): void {
    const fresh = reader.fromWindow > this.#windowIndex || reader.tookNothing();
    // A reader that took nothing yet reads all its windows; else it goes on where the read is
    const windows = fresh
      ? this.#windows.slice(reader.fromWindow)
      : this.#windowsFrom(this.#position);
    const skip = fresh || !this.#position ? 0 : (this.#atPosition.get(reader.topic) ?? 0);
    let own: AsyncIterator<Readonly<ReadResult>>;
    const abort = new AbortController();
    try {
      own = readWindows(this.#readRange, reader.topic, windows, abort.signal);
    } catch (error: unknown) {
      // Its waiting pull gets the error instead of waiting forever
      this.#readers.delete(reader);
      reader.end(error);
      return;
    }
    this.#readers.delete(reader);
    reader.detach(own, skip, abort);
  }
}
