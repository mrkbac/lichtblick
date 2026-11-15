// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ChunkMessageIndex } from "./ChunkCursor.ts";
import { McapIndexedReader } from "./McapIndexedReader.ts";
import { McapWriter } from "./McapWriter.ts";
import { TempBuffer } from "./TempBuffer.ts";
import { collect } from "./testUtils.ts";
import type { IReadable } from "./types.ts";

async function writeFile(): Promise<TempBuffer> {
  const buffer = new TempBuffer();
  // A tiny chunk size puts each message in its own chunk.
  const writer = new McapWriter({ writable: buffer, chunkSize: 1 });
  await writer.start({ profile: "", library: "" });
  const channelId = await writer.registerChannel({
    topic: "/a",
    schemaId: 0,
    messageEncoding: "json",
    metadata: new Map(),
  });
  for (let i = 0; i < 3; i++) {
    await writer.addMessage({
      channelId,
      sequence: i,
      logTime: BigInt(i),
      publishTime: BigInt(i),
      data: new Uint8Array([i]),
    });
  }
  await writer.end();
  return buffer;
}

async function collectData(reader: McapIndexedReader): Promise<number[]> {
  const data: number[] = [];
  for await (const message of reader.readMessages()) {
    data.push(message.data[0]!);
  }
  return data;
}

describe("McapIndexedReader chunkCache", () => {
  it("fills the cache and serves later reads from it without reading the chunks again", async () => {
    const buffer = await writeFile();
    const reads: bigint[] = [];
    const readable: IReadable = {
      size: async () => await buffer.size(),
      read: async (offset, size) => {
        reads.push(offset);
        return await buffer.read(offset, size);
      },
    };
    const cache = new Map<bigint, DataView>();
    const reader = await McapIndexedReader.Initialize({ readable, chunkCache: cache });
    const chunkOffsets = reader.chunkIndexes.map((chunk) => chunk.chunkStartOffset);
    expect(chunkOffsets).toHaveLength(3);

    await expect(collectData(reader)).resolves.toEqual([0, 1, 2]);
    expect([...cache.keys()]).toEqual(chunkOffsets);

    // A second reader sharing the cache reads message indexes but no chunk records.
    reads.length = 0;
    const second = await McapIndexedReader.Initialize({ readable, chunkCache: cache });
    await expect(collectData(second)).resolves.toEqual([0, 1, 2]);
    expect(reads.filter((offset) => chunkOffsets.includes(offset))).toEqual([]);
  });
});

describe("McapIndexedReader message index cache", () => {
  // Two channels in one chunk, written out of logTime order, with ties across channels
  const written: [channelId: number, logTime: bigint][] = [
    [0, 5n],
    [1, 3n],
    [0, 3n],
    [1, 9n],
    [0, 7n],
    [1, 5n],
    [0, 9n],
  ];

  async function writeInterleaved(): Promise<TempBuffer> {
    const buffer = new TempBuffer();
    const writer = new McapWriter({ writable: buffer });
    await writer.start({ profile: "", library: "" });
    for (const topic of ["/a", "/b"]) {
      await writer.registerChannel({
        topic,
        schemaId: 0,
        messageEncoding: "json",
        metadata: new Map(),
      });
    }
    for (const [i, [channelId, logTime]] of written.entries()) {
      await writer.addMessage({
        channelId,
        sequence: i,
        logTime,
        publishTime: 0n,
        data: new Uint8Array([i]),
      });
    }
    await writer.end();
    return buffer;
  }

  /** Message numbers in the expected order: by logTime, ties in write (= offset) order */
  function expected(args: {
    channel?: number;
    start?: bigint;
    end?: bigint;
    reverse?: boolean;
  }): number[] {
    const order = written
      .map(([channelId, logTime], i) => ({ channelId, logTime, i }))
      .filter(
        (m) =>
          (args.channel == undefined || m.channelId === args.channel) &&
          (args.start == undefined || m.logTime >= args.start) &&
          (args.end == undefined || m.logTime <= args.end),
      )
      .sort((a, b) => (a.logTime === b.logTime ? a.i - b.i : Number(a.logTime - b.logTime)))
      .map((m) => m.i);
    return args.reverse === true ? order.reverse() : order;
  }

  it("orders messages like an uncached read and parses each chunk's indexes once", async () => {
    const buffer = await writeInterleaved();
    let reads = 0;
    const readable: IReadable = {
      size: async () => await buffer.size(),
      read: async (offset, size) => {
        reads++;
        return await buffer.read(offset, size);
      },
    };
    const chunks = new Map<bigint, DataView>();
    const indexes = new Map<bigint, ChunkMessageIndex>();
    const reader = await McapIndexedReader.Initialize({
      readable,
      chunkCache: {
        get: (offset) => chunks.get(offset),
        set: (offset, data) => chunks.set(offset, data),
        getChunkMessageIndex: (offset) => indexes.get(offset),
        setChunkMessageIndex: (offset, index) => indexes.set(offset, index),
      },
    });
    const uncached = await McapIndexedReader.Initialize({ readable: buffer });
    const cases = [
      {},
      { reverse: true },
      { channel: 1 },
      { channel: 0, reverse: true },
      { start: 4n, end: 8n },
      { start: 5n, end: 9n, reverse: true },
      { channel: 1, start: 4n, end: 5n },
    ];
    for (const args of cases) {
      const readArgs = {
        topics: args.channel == undefined ? undefined : [args.channel === 0 ? "/a" : "/b"],
        startingAt: args.start,
        endingAt: args.end,
        reverse: args.reverse,
      };
      const got = (await collect(reader.readMessages(readArgs))).map((m) => m.data[0]);
      expect(got).toEqual(expected(args));
      const gotUncached = (await collect(uncached.readMessages(readArgs))).map((m) => m.data[0]);
      expect(gotUncached).toEqual(expected(args));
    }
    expect(indexes.size).toBe(1);
    expect([...indexes.values()][0]!.byteLength).toBe(written.length * (8 + 8 + 2));

    // Indexes and chunk both come from the cache now
    reads = 0;
    await collect(reader.readMessages({ topics: ["/b"] }));
    expect(reads).toBe(0);
  });
});
