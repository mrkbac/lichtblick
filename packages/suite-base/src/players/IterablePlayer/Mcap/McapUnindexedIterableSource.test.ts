// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  ChunkCache,
  McapRecordBuilder,
  McapTypes,
  McapWriter,
  Opcode,
  TempBuffer,
} from "@lichtblick/mcap-core";
import { McapUnindexedIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/McapUnindexedIterableSource";

/** A readable over `bytes` that counts its reads */
function readableOf(bytes: Uint8Array): McapTypes.IReadable & { reads: number } {
  const readable = {
    reads: 0,
    size: async () => BigInt(bytes.byteLength),
    read: async (offset: bigint, size: bigint) => {
      readable.reads++;
      if (offset + size > BigInt(bytes.byteLength)) {
        throw new Error("read past the end");
      }
      return bytes.slice(Number(offset), Number(offset + size));
    },
  };
  return readable;
}

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** An unchunked recording with topics "a" (channel 1) and "b" (channel 2) */
async function unchunked(
  messages: { channelId: number; logTime: bigint }[],
  { useChunks = false }: { useChunks?: boolean } = {},
): Promise<Uint8Array> {
  const buffer = new TempBuffer();
  const writer = new McapWriter({
    writable: buffer,
    startChannelId: 1,
    useChunks,
    useSummaryOffsets: false,
    useChunkIndex: false,
    useMessageIndex: false,
    useStatistics: false,
    repeatChannels: false,
    repeatSchemas: false,
  });
  await writer.start({ library: "", profile: "" });
  for (const topic of ["a", "b"]) {
    await writer.registerChannel({
      messageEncoding: "json",
      schemaId: 0,
      metadata: new Map(),
      topic,
    });
  }
  for (const [i, { channelId, logTime }] of messages.entries()) {
    await writer.addMessage({
      channelId,
      data: json({ i }),
      logTime,
      publishTime: logTime + 1n,
      sequence: i,
    });
  }
  await writer.end();
  return buffer.get().slice();
}

async function readAll(
  source: McapUnindexedIterableSource,
  topics: string[],
  range?: { start: bigint; end: bigint },
) {
  const out: { topic: string; ns: bigint; data: string }[] = [];
  for await (const result of source.messageIterator({
    topics: new Map(topics.map((topic) => [topic, { topic }])),
    start: range && {
      sec: Number(range.start / 1_000_000_000n),
      nsec: Number(range.start % 1_000_000_000n),
    },
    end: range && {
      sec: Number(range.end / 1_000_000_000n),
      nsec: Number(range.end % 1_000_000_000n),
    },
  })) {
    if (result.type === "message-event") {
      const { msgEvent } = result;
      out.push({
        topic: msgEvent.topic,
        ns: BigInt(msgEvent.receiveTime.sec) * 1_000_000_000n + BigInt(msgEvent.receiveTime.nsec),
        data: new TextDecoder().decode(msgEvent.message),
      });
    }
  }
  return out;
}

describe("McapUnindexedIterableSource", () => {
  it("returns the correct metadata", async () => {
    const tempBuffer = new TempBuffer();
    const writer = new McapWriter({ writable: tempBuffer });
    await writer.start({ library: "", profile: "" });
    await writer.addMetadata({
      name: "metadata1",
      metadata: new Map(Object.entries({ key: "value" })),
    });
    await writer.end();

    const source = new McapUnindexedIterableSource({ readable: readableOf(tempBuffer.get()) });
    const { metadata } = await source.initialize();

    expect(metadata).toEqual([{ name: "metadata1", metadata: { key: "value" } }]);
  });

  it("returns an empty array when no metadata is on the file", async () => {
    const tempBuffer = new TempBuffer();
    const writer = new McapWriter({ writable: tempBuffer });
    await writer.start({ library: "", profile: "" });
    await writer.end();

    const source = new McapUnindexedIterableSource({ readable: readableOf(tempBuffer.get()) });
    const { metadata } = await source.initialize();

    expect(metadata).toEqual([]);
  });

  it("returns undefined start and end before initialization", () => {
    const source = new McapUnindexedIterableSource({ readable: readableOf(new Uint8Array()) });
    expect(source.getStart()).toBeUndefined();
    expect(source.getEnd()).toBeUndefined();
  });

  it("reads messages lazily, in log time order, filtered by topic and time", async () => {
    // Given an unchunked recording written out of order
    const bytes = await unchunked([
      { channelId: 1, logTime: 5_000_000_000n },
      { channelId: 2, logTime: 2_000_000_000n },
      { channelId: 1, logTime: 1_000_000_000n },
      { channelId: 1, logTime: 3_000_000_000n },
    ]);
    const readable = readableOf(bytes);
    const source = new McapUnindexedIterableSource({ readable });

    // When
    const init = await source.initialize();

    // Then the time range and counts come from the scan
    expect(init.start).toEqual({ sec: 1, nsec: 0 });
    expect(init.end).toEqual({ sec: 5, nsec: 0 });
    expect(init.topicStats.get("a")).toEqual({ numMessages: 3 });
    expect(init.topicStats.get("b")).toEqual({ numMessages: 1 });

    // And messages come in log time order, with their data and publish time
    expect(await readAll(source, ["a", "b"])).toEqual([
      { topic: "a", ns: 1_000_000_000n, data: '{"i":2}' },
      { topic: "b", ns: 2_000_000_000n, data: '{"i":1}' },
      { topic: "a", ns: 3_000_000_000n, data: '{"i":3}' },
      { topic: "a", ns: 5_000_000_000n, data: '{"i":0}' },
    ]);
    expect(await readAll(source, ["a"], { start: 2_000_000_000n, end: 4_000_000_000n })).toEqual([
      { topic: "a", ns: 3_000_000_000n, data: '{"i":3}' },
    ]);
  });

  it("reads nearby messages in one read", async () => {
    const bytes = await unchunked(
      Array.from({ length: 100 }, (_, i) => ({ channelId: 1, logTime: BigInt(i) * 1000n })),
    );
    const readable = readableOf(bytes);
    const source = new McapUnindexedIterableSource({ readable });
    await source.initialize();
    readable.reads = 0;

    expect(await readAll(source, ["a"])).toHaveLength(100);
    expect(readable.reads).toBe(1);
  });

  it("backfills the last message of each topic at or before a time", async () => {
    const bytes = await unchunked([
      { channelId: 1, logTime: 1_000_000_000n },
      { channelId: 2, logTime: 2_000_000_000n },
      { channelId: 1, logTime: 3_000_000_000n },
      { channelId: 1, logTime: 5_000_000_000n },
    ]);
    const source = new McapUnindexedIterableSource({ readable: readableOf(bytes) });
    await source.initialize();

    const backfill = await source.getBackfillMessages({
      topics: new Map([
        ["a", { topic: "a" }],
        ["b", { topic: "b" }],
      ]),
      time: { sec: 3, nsec: 0 },
    });

    expect(
      backfill.map((event) => [event.topic, event.receiveTime.sec, event.publishTime?.nsec]),
    ).toEqual([
      ["a", 3, 1],
      ["b", 2, 1],
    ]);
  });

  it("reads chunked messages of a file without a chunk index", async () => {
    const bytes = await unchunked(
      [
        { channelId: 2, logTime: 2n },
        { channelId: 1, logTime: 1n },
      ],
      { useChunks: true },
    );
    const source = new McapUnindexedIterableSource({ readable: readableOf(bytes) });
    await source.initialize();

    expect(await readAll(source, ["a", "b"])).toEqual([
      { topic: "a", ns: 1n, data: '{"i":1}' },
      { topic: "b", ns: 2n, data: '{"i":0}' },
    ]);
  });

  it("reports differing schemas and channels instead of failing, keeping the first", async () => {
    // Given a recording that redefines schema 1 and channel 1 with different content
    const builder = new McapRecordBuilder();
    builder.writeMagic();
    builder.writeHeader({ library: "", profile: "" });
    builder.writeSchema({
      id: 1,
      name: "First",
      encoding: "jsonschema",
      data: json({ type: "object" }),
    });
    builder.writeChannel({
      id: 1,
      schemaId: 1,
      topic: "a",
      messageEncoding: "json",
      metadata: new Map(),
    });
    builder.writeMessage({
      channelId: 1,
      sequence: 0,
      logTime: 1n,
      publishTime: 1n,
      data: json(1),
    });
    builder.writeSchema({
      id: 1,
      name: "Second",
      encoding: "jsonschema",
      data: json({ type: "object" }),
    });
    builder.writeChannel({
      id: 1,
      schemaId: 1,
      topic: "b",
      messageEncoding: "json",
      metadata: new Map(),
    });
    builder.writeMessage({
      channelId: 1,
      sequence: 1,
      logTime: 2n,
      publishTime: 2n,
      data: json(2),
    });
    // And a message on a channel that was never defined
    builder.writeMessage({
      channelId: 9,
      sequence: 2,
      logTime: 3n,
      publishTime: 3n,
      data: json(3),
    });
    const source = new McapUnindexedIterableSource({
      readable: readableOf(builder.buffer.slice()),
    });

    // When
    const init = await source.initialize();

    // Then the file opens with the first definitions, and each problem is reported
    expect(init.topics.map((topic) => [topic.name, topic.schemaName])).toEqual([["a", "First"]]);
    expect(init.end).toEqual({ sec: 0, nsec: 2 });
    expect(init.alerts.map((alert) => alert.message)).toEqual(
      expect.arrayContaining([
        "Schema 1 is defined twice with different content",
        "Channel 1 is defined twice with different content",
        "1 messages on channel 9 were skipped",
      ]),
    );
    expect(await readAll(source, ["a"])).toHaveLength(2);
  });

  it("reads only the first `size` bytes and reports a cut-off record", async () => {
    const builder = new McapRecordBuilder();
    builder.writeMagic();
    builder.writeHeader({ library: "", profile: "" });
    builder.writeChannel({
      id: 1,
      schemaId: 0,
      topic: "a",
      messageEncoding: "json",
      metadata: new Map(),
    });
    builder.writeMessage({
      channelId: 1,
      sequence: 0,
      logTime: 1n,
      publishTime: 1n,
      data: json(1),
    });
    const firstEnd = builder.length;
    builder.writeMessage({
      channelId: 1,
      sequence: 1,
      logTime: 2n,
      publishTime: 2n,
      data: json(2),
    });
    const source = new McapUnindexedIterableSource({
      readable: readableOf(builder.buffer.slice()),
      size: firstEnd + 12, // in the middle of the second message
    });

    const init = await source.initialize();

    expect(init.end).toEqual({ sec: 0, nsec: 1 });
    expect(init.alerts.map((alert) => alert.message)).toContain(
      "This file ends in the middle of a record",
    );
  });
  it("ignores the definitions in a chunk that fails halfway", async () => {
    // Given a chunk (no CRC) that defines channel 1 as "broken", then ends mid-record
    const inner = new McapRecordBuilder();
    inner.writeChannel({
      id: 1,
      schemaId: 0,
      topic: "broken",
      messageEncoding: "json",
      metadata: new Map(),
    });
    const records = new Uint8Array([...inner.buffer, Opcode.MESSAGE, 0xff, 0, 0, 0, 0, 0, 0, 0]);
    const builder = new McapRecordBuilder();
    builder.writeMagic();
    builder.writeHeader({ library: "", profile: "" });
    builder.writeChunk({
      messageStartTime: 0n,
      messageEndTime: 0n,
      uncompressedSize: BigInt(records.byteLength),
      uncompressedCrc: 0,
      compression: "",
      records,
    });
    // And a valid definition of channel 1 after it
    builder.writeChannel({
      id: 1,
      schemaId: 0,
      topic: "a",
      messageEncoding: "json",
      metadata: new Map(),
    });
    builder.writeMessage({
      channelId: 1,
      sequence: 0,
      logTime: 1n,
      publishTime: 1n,
      data: json(1),
    });
    const source = new McapUnindexedIterableSource({
      readable: readableOf(builder.buffer.slice()),
    });

    const init = await source.initialize();

    // Then the valid definition names the channel
    expect(init.topics.map((topic) => topic.name)).toEqual(["a"]);
    expect(init.alerts.map((alert) => alert.message)).toContain(
      "Some records in this file are corrupt and were skipped",
    );
  });

  it("fails on a failed read instead of opening part of the file", async () => {
    // Given a chunk larger than the scan's read window, so it is fetched on its own
    const buffer = new TempBuffer();
    const writer = new McapWriter({ writable: buffer });
    await writer.start({ library: "", profile: "" });
    const channelId = await writer.registerChannel({
      messageEncoding: "json",
      schemaId: 0,
      metadata: new Map(),
      topic: "a",
    });
    await writer.addMessage({
      channelId,
      data: new Uint8Array(9 * 1024 * 1024),
      logTime: 1n,
      publishTime: 1n,
      sequence: 0,
    });
    await writer.end();
    const file = readableOf(buffer.get().slice());
    // And that fetch fails
    const readable: McapTypes.IReadable = {
      size: async () => await file.size(),
      read: async (offset, size) => {
        if (size > 8n * 1024n * 1024n) {
          throw new Error("network error");
        }
        return await file.read(offset, size);
      },
    };
    const source = new McapUnindexedIterableSource({ readable });

    await expect(source.initialize()).rejects.toThrow("network error");
  });

  it("reads a chunk once for concurrent readers", async () => {
    const bytes = await unchunked(
      [
        { channelId: 1, logTime: 1n },
        { channelId: 2, logTime: 2n },
      ],
      { useChunks: true },
    );
    const readable = readableOf(bytes);
    const source = new McapUnindexedIterableSource({ readable });
    await source.initialize();
    readable.reads = 0;

    const [a, b] = await Promise.all([readAll(source, ["a"]), readAll(source, ["b"])]);

    expect([a.length, b.length]).toEqual([1, 1]);
    expect(readable.reads).toBe(1);
  });
  it("skips a message record too short to read and keeps the rest", async () => {
    const builder = new McapRecordBuilder();
    builder.writeMagic();
    builder.writeHeader({ library: "", profile: "" });
    builder.writeChannel({
      id: 1,
      schemaId: 0,
      topic: "a",
      messageEncoding: "json",
      metadata: new Map(),
    });
    const after = new McapRecordBuilder();
    after.writeMessage({ channelId: 1, sequence: 0, logTime: 1n, publishTime: 1n, data: json(1) });
    const tooShort = [Opcode.MESSAGE, 4, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
    const bytes = new Uint8Array([...builder.buffer, ...tooShort, ...after.buffer]);
    const source = new McapUnindexedIterableSource({ readable: readableOf(bytes) });

    const init = await source.initialize();

    expect(init.alerts.map((alert) => alert.message)).toContain(
      "Some records in this file are corrupt and were skipped",
    );
    expect(await readAll(source, ["a"])).toHaveLength(1);
  });

  it("reads an empty compressed chunk without a warning, and names an unsupported one", async () => {
    const withChunk = async (compression: string) => {
      const builder = new McapRecordBuilder();
      builder.writeMagic();
      builder.writeHeader({ library: "", profile: "" });
      builder.writeChunk({
        messageStartTime: 0n,
        messageEndTime: 0n,
        uncompressedSize: compression === "zstd" ? 0n : 1n,
        uncompressedCrc: 0,
        compression,
        records: compression === "zstd" ? new Uint8Array() : new Uint8Array([1]),
      });
      const source = new McapUnindexedIterableSource({
        readable: readableOf(builder.buffer.slice()),
      });
      return (await source.initialize()).alerts;
    };

    expect((await withChunk("zstd")).map((alert) => alert.message)).not.toContain(
      "Some records in this file are corrupt and were skipped",
    );
    expect((await withChunk("custom")).map((alert) => alert.tip).join()).toContain(
      "Unsupported compression custom",
    );
  });

  it("keeps each reader's current chunk when the shared cache drops it", async () => {
    // Given a chunk of many messages and a cache that keeps nothing
    const bytes = await unchunked(
      Array.from({ length: 50 }, (_, i) => ({ channelId: (i % 2) + 1, logTime: BigInt(i) })),
      { useChunks: true },
    );
    const readable = readableOf(bytes);
    class NoCache extends ChunkCache {
      public override get(): undefined {
        return undefined;
      }
    }
    const source = new McapUnindexedIterableSource({ readable, chunkCache: new NoCache() });
    await source.initialize();
    readable.reads = 0;

    // When two readers take turns
    const iterate = (topic: string) =>
      source.messageIterator({ topics: new Map([[topic, { topic }]]) });
    const a = iterate("a");
    const b = iterate("b");
    let count = 0;
    while ((await a.next()).done !== true && (await b.next()).done !== true) {
      count += 2;
    }

    // Then each reads and decompresses the chunk once
    expect(count).toBe(50);
    expect(readable.reads).toBe(2);
  });
});
