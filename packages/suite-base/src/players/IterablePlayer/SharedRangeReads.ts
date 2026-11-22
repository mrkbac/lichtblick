// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";

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
 * Range reads of single topics (Plot, Log, Map… each read their topics' whole history) that start
 * at about the same time over the same range share one read of all their topics: one pass over
 * the recording instead of one per topic, which would also push each other's chunks out of the
 * source's chunk cache.
 */
// ponytail: a read that starts while a shared read is running makes its own pass; joining a running
// pass would need a second read for the part it missed
export class SharedRangeReads {
  readonly #readRange: ReadRange;
  /** Shared reads still gathering readers, by range */
  readonly #gathering = new Map<string, SharedRead>();

  public constructor(readRange: ReadRange) {
    this.#readRange = readRange;
  }

  public read(topic: string, range: Range): AsyncIterableIterator<Readonly<ReadResult>> {
    const key = `${timeKey(range.start)}-${timeKey(range.end)}`;
    let shared = this.#gathering.get(key);
    if (!shared) {
      const newShared = new SharedRead(this.#readRange, range);
      this.#gathering.set(key, newShared);
      setTimeout(() => {
        this.#gathering.delete(key);
        void newShared.run();
      }, GATHER_MS);
      shared = newShared;
    }
    return shared.join(topic);
  }
}

function timeKey(time: Time | undefined): string {
  return time ? `${time.sec}.${time.nsec}` : "";
}

class Reader implements AsyncIterableIterator<Readonly<ReadResult>> {
  public readonly topic: string;
  public queue: Readonly<ReadResult>[] = [];
  public queuedBytes = 0;
  #ended = false;
  #error?: Error;
  #wake?: () => void;
  readonly #onPull: () => void;
  readonly #onLeave: (reader: Reader) => void;

  public constructor(topic: string, onPull: () => void, onLeave: (reader: Reader) => void) {
    this.topic = topic;
    this.#onPull = onPull;
    this.#onLeave = onLeave;
  }

  public push(result: Readonly<ReadResult>): void {
    this.queue.push(result);
    if (result.type === "message-event") {
      this.queuedBytes += result.msgEvent.sizeInBytes;
    }
    this.#wake?.();
  }

  public end(error?: unknown): void {
    this.#ended = true;
    this.#error = error == undefined ? undefined : toError(error);
    this.#wake?.();
  }

  public async next(): Promise<IteratorResult<Readonly<ReadResult>>> {
    while (this.queue.length === 0 && !this.#ended) {
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
      this.#wake = undefined;
    }
    const result = this.queue.shift();
    if (result) {
      if (result.type === "message-event") {
        this.queuedBytes -= result.msgEvent.sizeInBytes;
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
    this.queue = [];
    this.queuedBytes = 0;
    this.#onLeave(this);
    this.#wake?.();
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
    const iterator = this.#readRange(topics, this.#range);
    try {
      for await (const result of iterator) {
        for (const reader of this.#readers) {
          if (result.type !== "message-event" || result.msgEvent.topic === reader.topic) {
            reader.push(result);
          }
        }
        // The slowest reader sets the pace, so what waits for it stays bounded
        while (
          this.#readers.size > 0 &&
          [...this.#readers].some((reader) => reader.queuedBytes > MAX_QUEUED_BYTES)
        ) {
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
    } finally {
      await iterator.return?.();
    }
  }
}
