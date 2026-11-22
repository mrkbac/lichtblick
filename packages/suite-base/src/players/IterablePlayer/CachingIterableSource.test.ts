// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { compare } from "@foxglove/rostime";

import { MessageEvent, Time } from "@lichtblick/suite";
import { mockTopicSelection } from "@lichtblick/suite-base/test/mocks/mockTopicSelection";

import { CachingIterableSource } from "./CachingIterableSource";
import {
  GetBackfillMessagesArgs,
  IIterableSource,
  Initialization,
  IteratorResult,
  MessageIteratorArgs,
} from "./IIterableSource";

const TEST_CACHE_BYTES = 600 * 1024 * 1024;

/**
 * A source with `count` messages per topic, one per topic at each second 0..count-1, that records
 * the topics and bytes of every read
 */
function recordingSource(topicNames: string[], count: number) {
  const reads: { topics: string[]; bytes: number; skimInterval?: Time }[] = [];
  const source = new TestSource();
  source.messageIterator = async function* (args: MessageIteratorArgs) {
    const read = {
      topics: [...args.topics.keys()],
      bytes: 0,
      ...(args.skimInterval && { skimInterval: args.skimInterval }),
    };
    reads.push(read);
    for (let sec = 0; sec < count; sec++) {
      const receiveTime = { sec, nsec: 0 };
      if (
        (args.start && compare(receiveTime, args.start) < 0) ||
        (args.end && compare(receiveTime, args.end) > 0)
      ) {
        continue;
      }
      for (const topic of topicNames) {
        if (args.topics.has(topic)) {
          read.bytes += 100;
          yield {
            type: "message-event",
            msgEvent: { topic, receiveTime, message: sec, sizeInBytes: 100, schemaName: "foo" },
          };
        }
      }
    }
  };
  return { source, reads };
}

function totalBytes(reads: { bytes: number }[]): number {
  return reads.reduce((sum, read) => sum + read.bytes, 0);
}

/** Reads the iterator to the end and returns the topics of its messages */
async function readTopics(
  iterator: AsyncIterableIterator<Readonly<IteratorResult>>,
  limit = Infinity,
) {
  const topics: string[] = [];
  for await (const result of iterator) {
    if (result.type === "message-event") {
      topics.push(result.msgEvent.topic);
    }
    if (topics.length >= limit) {
      break;
    }
  }
  return topics;
}

class TestSource implements IIterableSource {
  public waitForUpdate?: () => Promise<Initialization | undefined>;

  public async initialize(): Promise<Initialization> {
    return {
      start: { sec: 0, nsec: 0 },
      end: { sec: 10, nsec: 0 },
      topics: [],
      topicStats: new Map(),
      profile: undefined,
      alerts: [],
      datatypes: new Map(),
      publishersByTopic: new Map(),
    };
  }

  public async *messageIterator(
    _args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {}

  public async getBackfillMessages(_args: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    return [];
  }
}

describe("CachingIterableSource", () => {
  it("should construct and initialize", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });

    await bufferedSource.initialize();
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 0 }]);
  });

  it("doesn't count results a consumer stopped before they were stored", async () => {
    // Given a source with several messages at one time (pending until time moves on)
    const source = new TestSource();
    const cache = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });
    await cache.initialize();
    source.messageIterator = async function* () {
      for (let i = 0; i < 3; i++) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: 1, nsec: 0 },
            message: undefined,
            sizeInBytes: 10,
            schemaName: "foo",
          },
        };
      }
    };

    // When a consumer stops after the first one (e.g. on a seek)
    const iterator = cache.messageIterator({ topics: mockTopicSelection("a") });
    await iterator.next();
    await iterator.return?.(undefined);

    // Then nothing is left counted
    expect(cache.getCacheSize()).toBe(0);
  });

  it("keeps cached blocks outside the ranges an update changed", async () => {
    // Given a cache with blocks over 0–4 s and 6–9 s
    const source = new TestSource();
    const cache = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });
    await cache.initialize();
    const reads: MessageIteratorArgs[] = [];
    source.messageIterator = async function* (args) {
      reads.push(args);
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: args.start!,
          message: undefined,
          sizeInBytes: 1,
          schemaName: "foo",
        },
      };
    };
    const drain = async (start: number, end: number) => {
      const iterator = cache.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: start, nsec: 0 },
        end: { sec: end, nsec: 0 },
      });
      let result = await iterator.next();
      while (result.done !== true) {
        result = await iterator.next();
      }
    };
    await drain(0, 4);
    await drain(6, 9);

    // When the source reports new messages in 7–8 s
    source.waitForUpdate = async () => ({
      ...(await source.initialize()),
      updatedRanges: [{ start: { sec: 7, nsec: 0 }, end: { sec: 8, nsec: 0 } }],
    });
    await cache.waitForUpdate();
    reads.length = 0;
    await drain(0, 4);
    await drain(6, 9);

    // Then only the changed block is read again
    expect(reads.map((args) => args.start?.sec)).toEqual([6]);
  });

  it("should produce messages that the source produces", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 8; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: 0, nsec: i * 1e8 },
            message: undefined,
            sizeInBytes: 0,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // confirm messages are what we expect
      for (let i = 0; i < 8; ++i) {
        const iterResult = messageIterator.next();
        await expect(iterResult).resolves.toEqual({
          done: false,
          value: {
            type: "message-event",
            msgEvent: {
              receiveTime: { sec: 0, nsec: i * 1e8 },
              message: undefined,
              sizeInBytes: 0,
              topic: "a",
              schemaName: "foo",
            },
          },
        });
      }

      // The message iterator should be done since we have no more data to read from the source
      const iterResult = messageIterator.next();
      await expect(iterResult).resolves.toEqual({
        done: true,
      });

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }

    // because we have cached we shouldn't be calling source anymore
    source.messageIterator = function messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      throw new Error("should not be called");
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // confirm messages are what we expect
      for (let i = 0; i < 8; ++i) {
        const iterResult = messageIterator.next();
        await expect(iterResult).resolves.toEqual({
          done: false,
          value: {
            type: "message-event",
            msgEvent: {
              receiveTime: { sec: 0, nsec: i * 1e8 },
              message: undefined,
              sizeInBytes: 0,
              topic: "a",
              schemaName: "foo",
            },
          },
        });
      }

      // The message iterator should be done since we have no more data to read from the source
      const iterResult = messageIterator.next();
      await expect(iterResult).resolves.toEqual({
        done: true,
      });

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }
  });

  it("keeps the cache when topics shrink", async () => {
    const { source, reads } = recordingSource(["a", "b"], 10);
    const cache = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });
    await cache.initialize();
    await readTopics(cache.messageIterator({ topics: mockTopicSelection("a", "b") }));
    const size = cache.getCacheSize();
    reads.length = 0;

    const topics = await readTopics(cache.messageIterator({ topics: mockTopicSelection("a") }));

    expect(reads).toEqual([]);
    expect(topics).toEqual(Array(10).fill("a"));
    expect(cache.getCacheSize()).toBe(size);
    expect(cache.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
  });

  it("should yield correct messages when starting a new iterator before the the cached items", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });

    await bufferedSource.initialize();

    {
      source.messageIterator = async function* messageIterator(
        _args: MessageIteratorArgs,
      ): AsyncIterableIterator<Readonly<IteratorResult>> {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: 5, nsec: 0 },
            message: undefined,
            sizeInBytes: 0,
            schemaName: "foo",
          },
        };
      };

      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 5, nsec: 0 },
      });

      // Read one message
      {
        const iterResult = await messageIterator.next();
        expect(iterResult).toEqual({
          done: false,
          value: {
            type: "message-event",
            msgEvent: {
              receiveTime: { sec: 5, nsec: 0 },
              message: undefined,
              sizeInBytes: 0,
              topic: "a",
              schemaName: "foo",
            },
          },
        });
      }

      {
        const iterResult = await messageIterator.next();
        expect(iterResult).toEqual({
          done: true,
        });
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0.5, end: 1 }]);
    }

    // A new message iterator at the start time should emit the new message
    {
      source.messageIterator = async function* messageIterator(
        _args: MessageIteratorArgs,
      ): AsyncIterableIterator<Readonly<IteratorResult>> {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: 0, nsec: 0 },
            message: undefined,
            sizeInBytes: 0,
            schemaName: "foo",
          },
        };
      };

      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 0, nsec: 0 },
      });

      // Read one message
      {
        const iterResult = await messageIterator.next();
        expect(iterResult).toEqual({
          done: false,
          value: {
            type: "message-event",
            msgEvent: {
              receiveTime: { sec: 0, nsec: 0 },
              message: undefined,
              sizeInBytes: 0,
              topic: "a",
              schemaName: "foo",
            },
          },
        });
      }

      {
        const iterResult = await messageIterator.next();
        expect(iterResult).toEqual({
          done: false,
          value: {
            type: "message-event",
            msgEvent: {
              receiveTime: { sec: 5, nsec: 0 },
              message: undefined,
              sizeInBytes: 0,
              topic: "a",
              schemaName: "foo",
            },
          },
        });
      }

      {
        const iterResult = await messageIterator.next();
        expect(iterResult).toEqual({
          done: true,
        });
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }
  });

  it("should purge blocks when filled", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 100,
      maxTotalSize: 300,
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 0, nsec: 0 },
          message: undefined,
          sizeInBytes: 101,
          schemaName: "foo",
        },
      };

      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 5, nsec: 1 },
          message: undefined,
          sizeInBytes: 101,
          schemaName: "foo",
        },
      };

      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 10, nsec: 0 },
          message: undefined,
          sizeInBytes: 101,
          schemaName: "foo",
        },
      };
    };

    const messageIterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
    });

    // Reads the next message and updates the read head. The latter is done for the source to know
    // which blocks it can evict.
    const readNextMsgAndUpdateReadHead = async () => {
      const { done, value } = await messageIterator.next();
      if (done ?? false) {
        return;
      }
      if (value.type === "message-event") {
        bufferedSource.setCurrentReadHead(value.msgEvent.receiveTime);
      }
    };

    await readNextMsgAndUpdateReadHead();
    // Nothing has been actually saved into the cache but we did emit the first item
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 0 }]);

    await readNextMsgAndUpdateReadHead();
    // We've read another message which let us setup a block for all the time we've read till now
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 0.5 }]);

    await readNextMsgAndUpdateReadHead();
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0.5000000001, end: 0.9999999999 }]);

    await readNextMsgAndUpdateReadHead();
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0.5000000001, end: 1 }]);
  });

  it("should return fully cached when there is no data in the source", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 100,
      maxTotalSize: 300,
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      // no-op
    };

    const messageIterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
    });

    await messageIterator.next();
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
  });

  it("should respect end bounds when loading the cache", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 3, nsec: 0 },
          message: undefined,
          sizeInBytes: 0,
          schemaName: "foo",
        },
      };

      if ((args.end?.sec ?? 100) < 6) {
        return;
      }

      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 6, nsec: 0 },
          message: undefined,
          sizeInBytes: 0,
          schemaName: "foo",
        },
      };
    };

    const messageIterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      end: { sec: 4, nsec: 0 },
    });

    {
      const res = await messageIterator.next();
      expect(res.value).toEqual({
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 3, nsec: 0 },
          message: undefined,
          sizeInBytes: 0,
          schemaName: "foo",
        },
      });
    }

    {
      const res = await messageIterator.next();
      expect(res.done).toEqual(true);
    }
  });

  it("should respect end bounds when reading the cache", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 3, nsec: 0 },
          message: undefined,
          sizeInBytes: 0,
          schemaName: "foo",
        },
      };

      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 6, nsec: 0 },
          message: undefined,
          sizeInBytes: 0,
          schemaName: "foo",
        },
      };
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of messageIterator) {
        // no-op
      }
    }

    const messageIterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      end: { sec: 4, nsec: 0 },
    });

    {
      const res = await messageIterator.next();
      expect(res.value).toEqual({
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 3, nsec: 0 },
          message: undefined,
          sizeInBytes: 0,
          schemaName: "foo",
        },
      });
    }

    {
      const res = await messageIterator.next();
      expect(res.done).toEqual(true);
    }
  });

  it("should getBackfillMessages from cache", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 8; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: 0, nsec: i * 1e8 },
            message: undefined,
            sizeInBytes: 0,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // load all the messages into cache
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of messageIterator) {
        // no-op
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }

    // because we have cached we shouldn't be calling source anymore
    source.messageIterator = function messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      throw new Error("should not be called");
    };

    const backfill = await bufferedSource.getBackfillMessages({
      topics: mockTopicSelection("a"),
      time: { sec: 2, nsec: 0 },
    });
    expect(backfill).toEqual([
      {
        message: undefined,
        receiveTime: { sec: 0, nsec: 700000000 },
        sizeInBytes: 0,
        topic: "a",
        schemaName: "foo",
      },
    ]);
  });

  it("should getBackfillMessages from multiple cache blocks", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 100,
      maxTotalSize: TEST_CACHE_BYTES,
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 1, nsec: 0 },
          message: undefined,
          sizeInBytes: 101,
          schemaName: "foo",
        },
      };
      yield {
        type: "message-event",
        msgEvent: {
          topic: "b",
          receiveTime: { sec: 2, nsec: 0 },
          message: undefined,
          sizeInBytes: 101,
          schemaName: "foo",
        },
      };
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a", "b"),
      });

      // load all the messages into cache
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of messageIterator) {
        // no-op
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }

    // because we have cached we shouldn't be calling source anymore
    source.messageIterator = function messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      throw new Error("should not be called");
    };

    const backfill = await bufferedSource.getBackfillMessages({
      topics: mockTopicSelection("a", "b"),
      time: { sec: 2, nsec: 500 },
    });
    expect(backfill).toEqual([
      {
        message: undefined,
        receiveTime: { sec: 2, nsec: 0 },
        sizeInBytes: 101,
        topic: "b",
        schemaName: "foo",
      },
      {
        message: undefined,
        receiveTime: { sec: 1, nsec: 0 },
        sizeInBytes: 101,
        topic: "a",
        schemaName: "foo",
      },
    ]);
  });

  it("should evict blocks as cache fills up", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 102,
      maxTotalSize: 202,
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 8; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: undefined,
            sizeInBytes: 101,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // load all the messages into cache
      for await (const result of messageIterator) {
        // Update the current read head so the source knows which blocks it can evict.
        if (result.type === "message-event") {
          bufferedSource.setCurrentReadHead(result.msgEvent.receiveTime);
        }
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0.6, end: 1 }]);
    }
  });

  it("evicts as many blocks as a large message needs to stay under the cap", async () => {
    const source = new TestSource();
    const cache = new CachingIterableSource(source, { maxBlockSize: 100, maxTotalSize: 300 });
    await cache.initialize();

    const sizes = [50, 50, 50, 50, 50, 50, 150];
    source.messageIterator = async function* () {
      for (const [i, sizeInBytes] of sizes.entries()) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: undefined,
            sizeInBytes,
            schemaName: "foo",
          },
        };
      }
    };

    let maxCacheSize = 0;
    for await (const result of cache.messageIterator({ topics: mockTopicSelection("a") })) {
      if (result.type === "message-event") {
        cache.setCurrentReadHead(result.msgEvent.receiveTime);
      }
      maxCacheSize = Math.max(maxCacheSize, cache.getCacheSize());
    }
    expect(maxCacheSize).toBeLessThanOrEqual(300);
  });

  it("rejects a message without a size instead of losing count", async () => {
    const source = new TestSource();
    const cache = new CachingIterableSource(source, { maxTotalSize: 300 });
    await cache.initialize();
    source.messageIterator = async function* () {
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 0, nsec: 0 },
          message: undefined,
          sizeInBytes: undefined as unknown as number,
          schemaName: "foo",
        },
      };
    };

    await expect(async () => {
      const iterator = cache.messageIterator({ topics: mockTopicSelection("a") });
      while ((await iterator.next()).done !== true) {
        // read all
      }
    }).rejects.toThrow("message size must be a finite, non-negative byte count");
  });

  it("should report full cache as cache fills up", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 102,
      maxTotalSize: 202,
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 8; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: undefined,
            sizeInBytes: 101,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // At the start the cache is empty and the source can read messages
      expect(bufferedSource.canReadMore()).toBeTruthy();

      // The cache size after reading the first message should still allow reading a new message
      await messageIterator.next();
      expect(bufferedSource.canReadMore()).toBeTruthy();

      // Next message fills up the cache and the source can not read more messages
      await messageIterator.next();
      expect(bufferedSource.canReadMore()).toBeFalsy();
    }
  });

  it("should clear the cache when topics change", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 1000,
      maxTotalSize: 1000,
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 10; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: undefined,
            sizeInBytes: 100,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // load all the messages into cache
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of messageIterator) {
        // no-op
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a", "b"),
      });

      await messageIterator.next();

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 0 }]);
    }
  });

  it("should produce messages that have the same timestamp", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 100,
      maxTotalSize: TEST_CACHE_BYTES,
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 10; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: Math.floor(i / 3), nsec: 0 },
            message: { value: i },
            sizeInBytes: 50,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // confirm messages are what we expect
      for (let i = 0; i < 10; ++i) {
        const iterResult = messageIterator.next();
        await expect(iterResult).resolves.toEqual({
          done: false,
          value: {
            type: "message-event",
            msgEvent: {
              receiveTime: { sec: Math.floor(i / 3), nsec: 0 },
              message: { value: i },
              sizeInBytes: 50,
              topic: "a",
              schemaName: "foo",
            },
          },
        });
      }

      // The message iterator should be done since we have no more data to read from the source
      const iterResult = messageIterator.next();
      await expect(iterResult).resolves.toEqual({
        done: true,
      });

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }

    // because we have cached we shouldn't be calling source anymore
    source.messageIterator = function messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      throw new Error("should not be called");
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // confirm messages are what we expect when reading from the cache
      for (let i = 0; i < 10; ++i) {
        const iterResult = messageIterator.next();
        await expect(iterResult).resolves.toEqual({
          done: false,
          value: {
            type: "message-event",
            msgEvent: {
              receiveTime: { sec: Math.floor(i / 3), nsec: 0 },
              message: { value: i },
              sizeInBytes: 50,
              topic: "a",
              schemaName: "foo",
            },
          },
        });
      }

      // The message iterator should be done since we have no more data to read from the source
      const iterResult = messageIterator.next();
      await expect(iterResult).resolves.toEqual({
        done: true,
      });

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }
  });

  it("should getBackfillMessages from cache where messages have same timestamp", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 10; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: Math.floor(i / 3), nsec: 0 },
            message: { value: i },
            sizeInBytes: 0,
            schemaName: "foo",
          },
        };
        yield {
          type: "message-event",

          msgEvent: {
            topic: "b",
            receiveTime: { sec: Math.floor(i / 3), nsec: 0 },
            message: { value: i },
            sizeInBytes: 0,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a", "b"),
      });

      // load all the messages into cache
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of messageIterator) {
        // no-op
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }

    // because we have cached we shouldn't be calling source anymore
    source.messageIterator = function messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      throw new Error("should not be called");
    };

    const backfill = await bufferedSource.getBackfillMessages({
      topics: mockTopicSelection("a", "b"),
      time: { sec: 2, nsec: 0 },
    });

    expect(backfill).toEqual([
      {
        message: { value: 8 },
        receiveTime: { sec: 2, nsec: 0 },
        sizeInBytes: 0,
        topic: "b",
        schemaName: "foo",
      },
      {
        message: { value: 8 },
        receiveTime: { sec: 2, nsec: 0 },
        sizeInBytes: 0,
        topic: "a",
        schemaName: "foo",
      },
    ]);
  });

  it("should emit loadedRangesChange once until the ranges are read", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });
    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 8; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: undefined,
            sizeInBytes: 0,
            schemaName: "foo",
          },
        };
      }
    };

    const onChange = vi.fn();
    bufferedSource.on("loadedRangesChange", onChange);
    const messageIterator = bufferedSource.messageIterator({ topics: mockTopicSelection("a") });

    await messageIterator.next();
    await messageIterator.next();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 0.0999999999 }]);

    await messageIterator.next();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 0.1999999999 }]);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of messageIterator) {
      // drain
    }
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
  });

  describe("topic changes", () => {
    it("reads only the added topic for cached ranges", async () => {
      const { source, reads } = recordingSource(["a", "b"], 10);
      const cache = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });
      await cache.initialize();
      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a") }));
      reads.length = 0;

      const results: IteratorResult[] = [];
      for await (const result of cache.messageIterator({ topics: mockTopicSelection("a", "b") })) {
        results.push(result);
      }

      // Then only b is read, a comes from the cache, merged in time order (at the same time,
      // the read result first)
      expect(reads.map((read) => read.topics)).toEqual([["b"]]);
      const events = results.flatMap((r) => (r.type === "message-event" ? [r.msgEvent] : []));
      expect(events.map((e) => `${e.topic}${e.receiveTime.sec}`)).toEqual(
        Array.from({ length: 10 }, (_, sec) => [`b${sec}`, `a${sec}`]).flat(),
      );
      expect(cache.getCacheSize()).toBe(2000);

      // And both topics are cached now
      reads.length = 0;
      await readTopics(cache.messageIterator({ topics: mockTopicSelection("b") }));
      expect(reads).toEqual([]);
    });

    it("reads nothing again when a topic is toggled off and on", async () => {
      // Given 4 topics cached for the whole source
      const { source, reads } = recordingSource(["a", "b", "c", "d"], 10);
      const cache = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });
      await cache.initialize();
      const all = mockTopicSelection("a", "b", "c", "d");
      await readTopics(cache.messageIterator({ topics: all }));
      reads.length = 0;

      // When d is toggled off for the first half and on again
      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a", "b", "c") }), 15);
      await readTopics(cache.messageIterator({ topics: all }));

      // Then nothing is read again (before: 4000 + 4000 bytes)
      expect(totalBytes(reads)).toBe(0);
    });

    it("drops unsubscribed topics before starving read-ahead", async () => {
      // Given a full budget of a and b from the read head on (not evictable)
      const { source } = recordingSource(["a", "b"], 10);
      const cache = new CachingIterableSource(source, { maxTotalSize: 1000 });
      await cache.initialize();
      await readTopics(
        cache.messageIterator({ topics: mockTopicSelection("a", "b"), end: { sec: 4, nsec: 0 } }),
      );
      cache.setCurrentReadHead({ sec: 0, nsec: 0 });
      expect(cache.getCacheSize()).toBe(1000);

      // When playback goes on with b only
      const iterator = cache.messageIterator({ topics: mockTopicSelection("b") });

      // Then a's bytes make room for reading b further
      await iterator.next();
      expect(cache.canReadMore()).toBe(true);
      expect(await readTopics(iterator)).toEqual(Array(9).fill("b"));
      expect(cache.getCacheSize()).toBe(1000);
    });

    it("doesn't count the block being filled as room to read more", async () => {
      // Given a full budget of a and b in the block at the read head
      const { source } = recordingSource(["a", "b", "c"], 10);
      const cache = new CachingIterableSource(source, { maxTotalSize: 2000 });
      await cache.initialize();
      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a", "b") }));
      cache.setCurrentReadHead({ sec: 0, nsec: 0 });

      // When b is swapped for c, so that block is filled with c
      const iterator = cache.messageIterator({ topics: mockTopicSelection("a", "c") });
      await iterator.next();

      // Then b's bytes in it can't be dropped mid-fill, so there's no room
      expect(cache.canReadMore()).toBe(false);
      await iterator.return?.(undefined);
    });

    it("keeps the budget exact when a fill with out-of-order results stops anywhere", async () => {
      for (let stopAfter = 1; stopAfter <= 20; stopAfter++) {
        const { source } = recordingSource(["a"], 10);
        const cache = new CachingIterableSource(source, {
          maxTotalSize: TEST_CACHE_BYTES,
          maxBlockSize: 300,
        });
        await cache.initialize();
        await readTopics(cache.messageIterator({ topics: mockTopicSelection("a") }));
        // b arrives out of order: each pair swapped
        const fillRead = source.messageIterator.bind(source);
        source.messageIterator = async function* (args: MessageIteratorArgs) {
          if (!args.topics.has("b")) {
            yield* fillRead(args);
            return;
          }
          for (const sec of [1, 0, 3, 2, 5, 4, 7, 6, 9, 8]) {
            const receiveTime = { sec, nsec: 0 };
            if (
              (args.start && compare(receiveTime, args.start) < 0) ||
              (args.end && compare(receiveTime, args.end) > 0)
            ) {
              continue;
            }
            yield {
              type: "message-event",
              msgEvent: {
                topic: "b",
                receiveTime,
                message: sec,
                sizeInBytes: 100,
                schemaName: "foo",
              },
            };
          }
        };

        await readTopics(
          cache.messageIterator({ topics: mockTopicSelection("a", "b") }),
          stopAfter,
        );
        // Every stored result is counted once: reading everything fills the rest
        source.messageIterator = async function* (args: MessageIteratorArgs) {
          for (const sec of [...Array(10).keys()]) {
            if (args.start && sec < args.start.sec) {
              continue;
            }
            if (args.end && sec > args.end.sec) {
              continue;
            }
            yield {
              type: "message-event",
              msgEvent: {
                topic: "b",
                receiveTime: { sec, nsec: 0 },
                message: sec,
                sizeInBytes: 100,
                schemaName: "foo",
              },
            };
          }
        };
        const topics = await readTopics(
          cache.messageIterator({ topics: mockTopicSelection("a", "b") }),
        );
        // (a b result that arrived after a later one may be lost on an early stop, as in a
        // plain source read, but what's stored is counted exactly)
        expect(topics.filter((t) => t === "a")).toHaveLength(10);
        expect(cache.getCacheSize()).toBe(100 * topics.length);
      }
    });

    it("keeps cached results when the source returns results past the fill's end", async () => {
      const { source } = recordingSource(["a"], 10);
      const cache = new CachingIterableSource(source, {
        maxTotalSize: TEST_CACHE_BYTES,
        maxBlockSize: 300,
      });
      await cache.initialize();
      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a") }));
      // A source that ignores the end for b
      const readA = source.messageIterator.bind(source);
      source.messageIterator = async function* (args: MessageIteratorArgs) {
        if (!args.topics.has("b")) {
          yield* readA(args);
          return;
        }
        for (let sec = args.start?.sec ?? 0; sec < 10; sec++) {
          yield {
            type: "message-event",
            msgEvent: {
              topic: "b",
              receiveTime: { sec, nsec: 0 },
              message: sec,
              sizeInBytes: 100,
              schemaName: "foo",
            },
          };
        }
      };

      const filled = await readTopics(
        cache.messageIterator({ topics: mockTopicSelection("a", "b") }),
      );

      // Results past each block's end are neither yielded nor counted
      expect(filled).toEqual(Array(10).fill(["b", "a"]).flat());
      expect(cache.getCacheSize()).toBe(2000);
      const topics = await readTopics(cache.messageIterator({ topics: mockTopicSelection("a") }));
      expect(topics).toEqual(Array(10).fill("a"));
    });

    it("doesn't count an unsubscribed topic without messages as room", async () => {
      // Given a full budget of a, read together with c, which has no messages
      const { source } = recordingSource(["a"], 10);
      const cache = new CachingIterableSource(source, { maxTotalSize: 1000 });
      await cache.initialize();
      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a", "c") }));
      cache.setCurrentReadHead({ sec: 0, nsec: 0 });

      // When c is unsubscribed
      const iterator = cache.messageIterator({ topics: mockTopicSelection("a") });
      await iterator.next();

      // Then dropping it frees nothing
      expect(cache.canReadMore()).toBe(false);
      await iterator.return?.(undefined);
    });

    it("doesn't evict a block a read is still writing", async () => {
      // Given a read still writing its block with a full budget
      const { source } = recordingSource(["a"], 10);
      const cache = new CachingIterableSource(source, { maxTotalSize: 600 });
      await cache.initialize();
      const older = cache.messageIterator({ topics: mockTopicSelection("a") });
      for (let i = 0; i < 6; i++) {
        await older.next();
      }

      // When another read further on needs room
      const newer = cache.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 8, nsec: 0 },
      });
      await newer.next();

      // Then the block being written stays, and finishing both reads keeps the budget exact
      expect(cache.loadedRanges()[0]?.start).toBe(0);
      expect(cache.canReadMore()).toBe(false);
      await readTopics(older);
      await readTopics(newer);
      const stored = await readTopics(cache.messageIterator({ topics: mockTopicSelection("a") }));
      expect(cache.getCacheSize()).toBe(100 * stored.length);
    });

    it("drops unwanted results only from blocks no read is writing", async () => {
      // Given a read of a and b still writing its block with a full budget
      const { source } = recordingSource(["a", "b"], 10);
      const cache = new CachingIterableSource(source, { maxTotalSize: 600 });
      await cache.initialize();
      const older = cache.messageIterator({ topics: mockTopicSelection("a", "b") });
      for (let i = 0; i < 6; i++) {
        await older.next();
      }

      // When a newer read wants b only
      const newer = cache.messageIterator({ topics: mockTopicSelection("b") });
      await newer.next();

      // Then the block being written isn't room to read more
      expect(cache.canReadMore()).toBe(false);
      // Until the older read is done with it
      await older.return?.(undefined);
      expect(cache.canReadMore()).toBe(true);
      await newer.return?.(undefined);
    });

    it("yields a cached stamp only after the added topic's messages at its time", async () => {
      const source = new TestSource();
      const cache = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });
      await cache.initialize();
      const message = (topic: string): IteratorResult => ({
        type: "message-event",
        msgEvent: {
          topic,
          receiveTime: { sec: 1, nsec: 0 },
          message: undefined,
          sizeInBytes: 1,
          schemaName: "foo",
        },
      });
      source.messageIterator = async function* (args: MessageIteratorArgs) {
        if (args.topics.has("b")) {
          yield message("b");
          return;
        }
        yield message("a");
        yield { type: "stamp", stamp: { sec: 1, nsec: 0 } };
      };
      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a") }));

      const types: string[] = [];
      for await (const result of cache.messageIterator({ topics: mockTopicSelection("a", "b") })) {
        types.push(result.type === "message-event" ? result.msgEvent.topic : result.type);
      }

      // The player ends a tick at a stamp: b must come before it
      expect(types.indexOf("stamp")).toBeGreaterThan(types.indexOf("b"));
      expect(types.sort()).toEqual(["a", "b", "stamp"]);
    });

    it("keeps the cache and budget consistent when a fill is stopped early", async () => {
      const { source, reads } = recordingSource(["a", "b"], 10);
      const cache = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });
      await cache.initialize();
      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a") }));

      // When the consumer stops halfway through filling b (e.g. a seek)
      const topics = await readTopics(
        cache.messageIterator({
          topics: mockTopicSelection("a", "b"),
          start: { sec: 3, nsec: 0 },
        }),
        5,
      );
      expect(topics).toEqual(["b", "a", "b", "a", "b"]);
      // b@3..4 are filled; b@5 was read but not stored
      expect(cache.getCacheSize()).toBe(1000 + 200);

      // Then reading everything again reads b only where it's missing, once
      reads.length = 0;
      const results = await readTopics(
        cache.messageIterator({ topics: mockTopicSelection("a", "b") }),
      );
      expect(results).toEqual(Array(10).fill(["b", "a"]).flat());
      expect(reads.map((read) => read.topics)).toEqual([["b"], ["b"]]);
      expect(totalBytes(reads)).toBe(800);
      expect(cache.getCacheSize()).toBe(2000);
      expect(cache.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    });

    it("splits filled blocks at the block size limit", async () => {
      const { source } = recordingSource(["a", "b"], 10);
      const cache = new CachingIterableSource(source, {
        maxTotalSize: TEST_CACHE_BYTES,
        maxBlockSize: 1000,
      });
      await cache.initialize();
      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a") }));

      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a", "b") }));

      expect(cache.getCacheSize()).toBe(2000);
      expect(cache.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
      expect(await readTopics(cache.messageIterator({ topics: mockTopicSelection("b") }))).toEqual(
        Array(10).fill("b"),
      );
    });

    it("counts only blocks with every wanted topic as loaded", async () => {
      const { source } = recordingSource(["a", "b"], 10);
      const cache = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });
      await cache.initialize();
      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a") }));

      const iterator = cache.messageIterator({ topics: mockTopicSelection("a", "b") });
      await iterator.next();

      expect(cache.loadedRanges()).toEqual([{ start: 0, end: 0 }]);
      await iterator.return?.(undefined);
    });

    it("backfills a topic a block lacks from the source", async () => {
      const { source } = recordingSource(["a", "b"], 10);
      const cache = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });
      await cache.initialize();
      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a") }));
      const backfill = vi.fn().mockResolvedValue([]);
      source.getBackfillMessages = backfill;

      const messages = await cache.getBackfillMessages({
        topics: mockTopicSelection("a", "b"),
        time: { sec: 5, nsec: 0 },
      });

      expect(messages.map((m) => m.topic)).toEqual(["a"]);
      expect(backfill).toHaveBeenCalledWith(
        expect.objectContaining({ topics: mockTopicSelection("b") }),
      );
    });
  });

  describe("skim interval changes", () => {
    it("doesn't serve a longer skim interval from shorter-skimmed blocks", async () => {
      const { source, reads } = recordingSource(["a"], 10);
      const cache = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });
      await cache.initialize();
      await readTopics(
        cache.messageIterator({
          topics: mockTopicSelection("a"),
          skimInterval: { sec: 1, nsec: 0 },
        }),
      );
      reads.length = 0;

      // Windows of another length pick other messages
      await readTopics(
        cache.messageIterator({
          topics: mockTopicSelection("a"),
          skimInterval: { sec: 2, nsec: 0 },
        }),
      );

      expect(reads).toEqual([{ topics: ["a"], bytes: 1000, skimInterval: { sec: 2, nsec: 0 } }]);
      expect(cache.getCacheSize()).toBe(1000);
    });

    it("serves a skimmed read from full blocks, thinned like a skimmed source read", async () => {
      const { source, reads } = recordingSource(["a", "b"], 10);
      const cache = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });
      await cache.initialize();
      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a", "b") }));
      reads.length = 0;

      const results: string[] = [];
      for await (const result of cache.messageIterator({
        topics: mockTopicSelection("a", "b"),
        skimInterval: { sec: 2, nsec: 0 },
      })) {
        results.push(
          result.type === "message-event"
            ? `${result.msgEvent.topic}${result.msgEvent.receiveTime.sec}`
            : result.type === "stamp"
              ? `stamp${result.stamp.sec}`
              : result.type,
        );
      }

      // Then nothing is read, and each 2 s window yields its last message per topic and a stamp
      expect(reads).toEqual([]);
      expect(results).toEqual([
        ...["a1", "b1", "stamp1"],
        ...["a3", "b3", "stamp3"],
        ...["a5", "b5", "stamp5"],
        ...["a7", "b7", "stamp7"],
        ...["a9", "b9"],
      ]);
    });

    it("reads a range skimmed instead of filling a full block during a skimmed read", async () => {
      const { source, reads } = recordingSource(["a", "b"], 10);
      const cache = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });
      await cache.initialize();
      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a") }));
      reads.length = 0;

      await readTopics(
        cache.messageIterator({
          topics: mockTopicSelection("a", "b"),
          skimInterval: { sec: 2, nsec: 0 },
        }),
      );

      // Then b isn't read at full density, and the full block stays as it was
      expect(reads.map(({ topics, skimInterval }) => ({ topics, skimInterval }))).toEqual([
        { topics: ["a", "b"], skimInterval: { sec: 2, nsec: 0 } },
      ]);
      expect(cache.getCacheSize()).toBe(1000);
      reads.length = 0;
      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a") }));
      expect(reads).toEqual([]);
    });

    it("reads skimmed ranges again for a full read", async () => {
      const { source, reads } = recordingSource(["a"], 10);
      const cache = new CachingIterableSource(source, { maxTotalSize: TEST_CACHE_BYTES });
      await cache.initialize();
      await readTopics(
        cache.messageIterator({
          topics: mockTopicSelection("a"),
          skimInterval: { sec: 2, nsec: 0 },
        }),
      );
      reads.length = 0;

      await readTopics(cache.messageIterator({ topics: mockTopicSelection("a") }));

      expect(reads).toEqual([{ topics: ["a"], bytes: 1000 }]);
      expect(cache.getCacheSize()).toBe(1000);
    });
  });
});
