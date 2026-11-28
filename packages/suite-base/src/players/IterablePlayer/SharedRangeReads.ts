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

/** Smallest window a playhead-first pass reads around the playhead */
const MIN_WINDOW_NS = 20_000_000_000n;

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
  let size = (last - first) / 32n;
  if (size < MIN_WINDOW_NS) {
    size = MIN_WINDOW_NS;
  }
  const at = toNanoSec(playhead);
  const clamp = (ns: bigint) => (ns < first ? first : ns > last ? last : ns);
  let lo = clamp(at - size / 2n);
  let hi = clamp(at + size / 2n);
  const spans: [bigint, bigint][] = [[lo, hi]];
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
  return spans.map(([from, to]) => ({
    start: from === first ? undefined : fromNanoSec(from),
    end: to === last ? undefined : fromNanoSec(to),
  }));
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
 * message two panels want is decoded once. Reads that start at about the same time gather into a
 * new pass; a read that starts while a pass is running joins it (reading only the part the pass
 * already went past on its own). Reads of part of the recording (e.g. stepping to the next
 * message) start right away on their own.
 *
 * A playhead-first read gets the history around the playhead first, then window by window earlier
 * and later history (see playheadWindows): each window in time order, and each window entirely
 * before or entirely after everything delivered before it. A pass is playhead-first only while
 * all its readers are: an ascending reader in a playhead-first pass would have to hold everything
 * read before the recording's start comes, about the whole topic. A playhead-first reader takes an
 * ascending pass instead (one window in time order keeps its contract), so a layout with an
 * ascending reader (e.g. 3D transform preloading) still reads the recording once. Only an
 * ascending read that starts while a playhead-first pass runs gets a pass of its own.
 */
export class SharedRangeReads {
  readonly #readRange: ReadRange;
  readonly #playhead: () => Playhead | undefined;
  /** The shared read still gathering readers; ascending once any of them is */
  #gathering?: { shared: SharedRead; ascending: boolean };
  /** Per order (playhead-first or not), the shared read running now, which a new read joins */
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
    const join = () => {
      const gathering = this.#gathering;
      if (gathering) {
        gathering.ascending ||= !playheadFirst;
        return gathering.shared.join(topic);
      }
      // Any reader can join a running ascending pass; only a playhead-first one a playhead-first pass
      for (const order of playheadFirst ? [false, true] : [false]) {
        const running = this.#running.get(order);
        if (running?.isJoinable() === true) {
          return running.joinLate(topic);
        }
      }
      const pending: { shared: SharedRead; ascending: boolean } = {
        // The playhead as it is when the pass starts
        shared: new SharedRead(this.#readRange, () => {
          const playhead = pending.ascending ? undefined : this.#playhead();
          return playhead ? playheadWindows(playhead) : [range];
        }),
        ascending: !playheadFirst,
      };
      this.#gathering = pending;
      setTimeout(() => {
        this.#gathering = undefined;
        const order = !pending.ascending;
        this.#running.set(order, pending.shared);
        void pending.shared.run().finally(() => {
          if (this.#running.get(order) === pending.shared) {
            this.#running.delete(order);
          }
        });
      }, GATHER_MS);
      return pending.shared.join(topic);
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
  /** A late joiner's read of what the shared read went past before it joined, delivered first */
  #catchUp?: { iterator: AsyncIterator<Readonly<ReadResult>>; abort: AbortController };
  /** A late joiner ignores the shared read's messages up to here: its catch-up has them */
  #dropThrough?: Time;
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
    if (
      this.#dropThrough &&
      result.type === "message-event" &&
      compare(result.msgEvent.receiveTime, this.#dropThrough) <= 0
    ) {
      return;
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

  /**
   * Delivers `iterator` before what the shared read pushes; it reads the shared read's current
   * window up to and including `through`
   */
  public catchUp(
    iterator: AsyncIterator<Readonly<ReadResult>>,
    through: Time | undefined,
    abort: AbortController,
  ): void {
    this.#catchUp = { iterator, abort };
    this.#dropThrough = through;
  }

  /** The shared read starts its next window, which the catch-up doesn't read */
  public windowStarted(): void {
    this.#dropThrough = undefined;
  }

  public isCatchingUp(): boolean {
    return this.#catchUp != undefined;
  }

  /**
   * While catching up its queue filled: drop the queue and go on with `readFrom(time of its first
   * queued message)` after the catch-up, so the shared read never waits for it. The queue holds
   * every message of its topic from that time on, so nothing is lost or delivered twice.
   */
  public detachQueue(
    readFrom: (start: Time, signal: AbortSignal) => AsyncIterator<Readonly<ReadResult>>,
  ): void {
    let first: Time | undefined;
    for (let i = 0; i < this.#queue.size(); i++) {
      const result = this.#queue.at(i);
      if (result?.type === "message-event") {
        first = result.msgEvent.receiveTime;
        break;
      }
    }
    if (!first) {
      return;
    }
    this.#queue.clear();
    this.#queuedBytes = 0;
    const abort = new AbortController();
    this.detach(readFrom(first, abort.signal), 0, abort);
  }

  /** Goes on with `own`, skipping its first `skip` messages; the queue is empty */
  public detach(
    iterator: AsyncIterator<Readonly<ReadResult>>,
    skip: number,
    abort: AbortController,
  ): void {
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

  async #pull(): Promise<IteratorResult<Readonly<ReadResult>>> {
    while (this.#catchUp && !this.#ended) {
      const catchUp = this.#catchUp;
      const result = await new Promise<IteratorResult<Readonly<ReadResult>>>((resolve, reject) => {
        this.#cancelPull = () => {
          resolve({ done: true, value: undefined });
        };
        catchUp.iterator.next().then(resolve, reject);
      }).finally(() => {
        this.#cancelPull = undefined;
      });
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
        const ownRead = this.#own.iterator;
        const own = await new Promise<IteratorResult<Readonly<ReadResult>>>((resolve, reject) => {
          this.#cancelPull = () => {
            resolve({ done: true, value: undefined });
          };
          ownRead.next().then(resolve, reject);
        }).finally(() => {
          this.#cancelPull = undefined;
        });
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
    this.#catchUp?.abort.abort();
    // Sources without cancellable I/O may finish closing after their current pull.
    void Promise.resolve(this.#own?.iterator.return?.()).catch(() => {});
    void Promise.resolve(this.#catchUp?.iterator.return?.()).catch(() => {});
    this.#catchUp = undefined;
    this.#queue.clear();
    this.#queuedBytes = 0;
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
  /** The windows it reads, in order, and the one it reads now */
  #windows: Range[] = [];
  #windowIndex = 0;
  readonly #readers = new Set<Reader>();
  readonly #abort = new AbortController();
  #running = false;
  #pulled?: () => void;
  /** Receive time of the last message read, and per topic how many messages had that time */
  #position?: Time;
  readonly #atPosition = new Map<string, number>();

  public constructor(readRange: ReadRange, plan: () => Range[]) {
    this.#readRange = readRange;
    this.#plan = plan;
  }

  /** The windows from `time` (in one of them) on: the current window from there, then the rest */
  #windowsFrom(time: Time | undefined): Range[] {
    if (!time) {
      return this.#windows.slice(this.#windowIndex);
    }
    const index = this.#windows.findIndex(
      ({ start, end }) =>
        (!start || compare(start, time) <= 0) && (!end || compare(time, end) <= 0),
    );
    return [{ start: time, end: this.#windows[index]?.end }, ...this.#windows.slice(index + 1)];
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
   * Joins while the read runs: the reader first reads, on its own, what the shared read already
   * went past, and the shared read goes on from where it is with this topic added.
   */
  public joinLate(topic: string): Reader {
    const reader = this.join(topic);
    const position = this.#position;
    const current = this.#windows[this.#windowIndex];
    // The windows read already, then the current one up to where the shared read is
    const missed = this.#windows.slice(0, this.#windowIndex);
    if (position) {
      missed.push({ start: current?.start, end: position });
    }
    if (missed.length > 0) {
      const abort = new AbortController();
      try {
        reader.catchUp(readWindows(this.#readRange, topic, missed, abort.signal), position, abort);
      } catch (error: unknown) {
        this.#readers.delete(reader);
        reader.end(error);
        return reader;
      }
    }
    // Read the new topic too: restart the source read where the shared read is
    if (!this.#topics.has(topic)) {
      this.#restart = true;
      this.#iteration?.abort();
    }
    return reader;
  }

  #ended = false;
  #restart = false;
  /** Read through a method: joinLate sets it during the awaits, which narrowing can't see */
  #restartRequested(): boolean {
    return this.#restart;
  }
  /** Topics the current source read reads */
  #topics: TopicSelection = new Map();
  /** Aborts the current source read only (to restart it); #abort ends the whole shared read */
  #iteration?: AbortController;

  public async run(): Promise<void> {
    if (this.#readers.size === 0) {
      return;
    }
    this.#windows = this.#plan();
    this.#running = true;
    try {
      for (this.#windowIndex = 0; this.#windowIndex < this.#windows.length; this.#windowIndex++) {
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

  /** Reads one window for all readers, restarting where it is when a reader with a new topic joins */
  async #runWindow(span: Range): Promise<void> {
    this.#position = undefined;
    this.#atPosition.clear();
    for (const reader of this.#readers) {
      reader.windowStarted();
    }
    let start = span.start;
    // Messages at the restart position the shared read delivered already, per topic
    let delivered = new Map<string, number>();
    for (;;) {
      this.#restart = false;
      this.#topics = new Map(
        [...this.#readers].map((reader) => [reader.topic, { topic: reader.topic }]),
      );
      const iteration = (this.#iteration = new AbortController());
      const onAbort = () => {
        iteration.abort();
      };
      this.#abort.signal.addEventListener("abort", onAbort);
      try {
        for await (const result of this.#readRange(
          this.#topics,
          { start, end: span.end },
          iteration.signal,
        )) {
          if (this.#restartRequested()) {
            break;
          }
          if (result.type === "message-event") {
            const { topic, receiveTime } = result.msgEvent;
            const already = delivered.get(topic) ?? 0;
            if (already > 0 && this.#position && compare(receiveTime, this.#position) === 0) {
              delivered.set(topic, already - 1);
              continue;
            }
            if (!this.#position || compare(receiveTime, this.#position) !== 0) {
              this.#position = receiveTime;
              this.#atPosition.clear();
            }
            this.#atPosition.set(topic, (this.#atPosition.get(topic) ?? 0) + 1);
          }
          for (const reader of this.#readers) {
            if (result.type !== "message-event" || result.msgEvent.topic === reader.topic) {
              reader.push(result);
            }
          }
          // The slowest reader sets the pace, so what waits for it stays bounded. A consumer may
          // wait on one reader before it empties another (e.g. merging inputs by time): readers
          // waiting while the read waits for room go on with their own read instead of blocking
          // each other. A late joiner still catching up goes on with its own read too.
          while (this.#readers.values().some((reader) => reader.isFull())) {
            for (const reader of this.#readers) {
              if (reader.waiting) {
                this.#detach(reader);
              } else if (reader.isCatchingUp() && reader.isFull()) {
                this.#readers.delete(reader);
                reader.detachQueue((from, signal) =>
                  readWindows(this.#readRange, reader.topic, this.#windowsFrom(from), signal),
                );
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
      } catch (error: unknown) {
        // Aborted to restart with another topic: go on below
        if (!this.#restartRequested()) {
          throw error;
        }
      } finally {
        this.#abort.signal.removeEventListener("abort", onAbort);
      }
      if (!this.#restartRequested() || this.#readers.size === 0 || this.#abort.signal.aborted) {
        break;
      }
      // Restart where the shared read is; skip what it delivered at that time already
      start = this.#position ?? span.start;
      delivered = new Map(this.#atPosition);
    }
  }

  /** Continues `reader` with its own read from where the shared read is */
  #detach(reader: Reader): void {
    const position = this.#position;
    let own: AsyncIterator<Readonly<ReadResult>>;
    const abort = new AbortController();
    try {
      own = readWindows(this.#readRange, reader.topic, this.#windowsFrom(position), abort.signal);
    } catch (error: unknown) {
      // Its waiting pull gets the error instead of waiting forever
      this.#readers.delete(reader);
      reader.end(error);
      return;
    }
    this.#readers.delete(reader);
    reader.detach(own, position ? (this.#atPosition.get(reader.topic) ?? 0) : 0, abort);
  }
}
