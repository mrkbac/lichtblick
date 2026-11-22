// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare, Time } from "@foxglove/rostime";

import { VecQueue } from "@lichtblick/den/collection";
import { TopicSelection } from "@lichtblick/suite-base/players/types";
import { toError } from "@lichtblick/suite-base/util/toError";

import { IteratorResult as ReadResult } from "./IIterableSource";

type Range = { start?: Time; end?: Time };

type ReadRange = (
  topics: TopicSelection,
  range: Range,
) => AsyncIterableIterator<Readonly<ReadResult>>;

/** Bytes of messages one reader may have waiting before the shared read waits for it */
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;

/** How long a range read waits for others over the same range to join it */
const GATHER_MS = 10;

/**
 * Reads of single topics' whole history (Plot, Log, Map…) that start at about the same time share
 * one read of all their topics: one pass over the recording instead of one per topic, which would
 * also push each other's chunks out of the source's chunk cache. Reads of part of the recording
 * (e.g. stepping to the next message) start right away on their own.
 */
// ponytail: a read that starts while a shared read is running makes its own pass; joining a running
// pass would need a second read for the part it missed
export class SharedRangeReads {
  readonly #readRange: ReadRange;
  /** The shared read still gathering readers */
  #gathering?: SharedRead;

  public constructor(readRange: ReadRange) {
    this.#readRange = readRange;
  }

  public read(topic: string, range: Range): AsyncIterableIterator<Readonly<ReadResult>> {
    if (range.start || range.end) {
      return this.#readRange(new Map([[topic, { topic }]]), range);
    }
    // Joins a shared read on its first pull: an iterator that is never read can't hold up others
    let reader: Reader | undefined;
    let closed = false;
    const join = () => {
      let shared = this.#gathering;
      if (!shared) {
        const newShared = new SharedRead(this.#readRange, range);
        this.#gathering = newShared;
        setTimeout(() => {
          this.#gathering = undefined;
          void newShared.run();
        }, GATHER_MS);
        shared = newShared;
      }
      return shared.join(topic);
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
  #own?: AsyncIterator<Readonly<ReadResult>>;
  /** Messages of its own read to skip: the shared read delivered them already */
  #skip = 0;
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

  /** Goes on with `own`, skipping its first `skip` messages; the queue is empty */
  public detach(own: AsyncIterator<Readonly<ReadResult>>, skip: number): void {
    this.#own = own;
    this.#skip = skip;
    this.#ready?.resolve();
    this.#ready = undefined;
  }

  public async next(): Promise<IteratorResult<Readonly<ReadResult>>> {
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
        const own = await this.#own.next();
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
    await this.#own?.return?.();
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
  readonly #range: Range;
  readonly #readers = new Set<Reader>();
  #pulled?: () => void;
  /** Receive time of the last message read, and per topic how many messages had that time */
  #position?: Time;
  readonly #atPosition = new Map<string, number>();

  public constructor(readRange: ReadRange, range: Range) {
    this.#readRange = readRange;
    this.#range = range;
  }

  public join(topic: string): Reader {
    const reader = new Reader(
      topic,
      () => this.#pulled?.(),
      (left) => {
        this.#readers.delete(left);
        this.#pulled?.();
      },
    );
    this.#readers.add(reader);
    return reader;
  }

  public async run(): Promise<void> {
    if (this.#readers.size === 0) {
      return;
    }
    const topics: TopicSelection = new Map(
      [...this.#readers].map((reader) => [reader.topic, { topic: reader.topic }]),
    );
    try {
      for await (const result of this.#readRange(topics, this.#range)) {
        if (result.type === "message-event") {
          const { topic, receiveTime } = result.msgEvent;
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
        // The slowest reader sets the pace, so what waits for it stays bounded. A consumer may wait
        // on one reader before it empties another (e.g. merging inputs by time): readers waiting
        // while the read waits for room go on with their own read instead of blocking each other.
        while (this.#readers.values().some((reader) => reader.isFull())) {
          for (const reader of this.#readers) {
            // Waiting with nothing queued: the shared read can't get it anything without room
            if (reader.waiting) {
              this.#detach(reader);
            }
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
      for (const reader of this.#readers) {
        reader.end();
      }
    } catch (error: unknown) {
      for (const reader of this.#readers) {
        reader.end(error);
      }
    }
  }

  /** Continues `reader` with its own read from where the shared read is */
  #detach(reader: Reader): void {
    const position = this.#position;
    let own: AsyncIterator<Readonly<ReadResult>>;
    try {
      own = this.#readRange(new Map([[reader.topic, { topic: reader.topic }]]), {
        start: position ?? this.#range.start,
        end: this.#range.end,
      });
    } catch (error: unknown) {
      // Its waiting pull gets the error instead of waiting forever
      this.#readers.delete(reader);
      reader.end(error);
      return;
    }
    this.#readers.delete(reader);
    reader.detach(own, position ? (this.#atPosition.get(reader.topic) ?? 0) : 0);
  }
}
