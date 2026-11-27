// SPDX-FileCopyrightText: Copyright (c) Foxglove Technologies Inc
// SPDX-License-Identifier: MIT

import { crc32 } from "@foxglove/crc";

import { ChunkBuilder } from "./ChunkBuilder.ts";
import type { ChunkMessageIndex } from "./ChunkCursor.ts";
import { McapIndexedReader, type ChunkDataCache } from "./McapIndexedReader.ts";
import { McapRecordBuilder } from "./McapRecordBuilder.ts";
import { McapWriter } from "./McapWriter.ts";
import { TempBuffer } from "./TempBuffer.ts";
import { MCAP_MAGIC, Opcode } from "./constants.ts";
import {
  record,
  uint64LE,
  uint32LE,
  string,
  keyValues,
  collect,
  uint16LE,
  uint32PrefixedBytes,
} from "./testUtils.ts";
import type { Channel, TypedMcapRecord, TypedMcapRecords } from "./types.ts";

/**
 * Create an IReadable from a buffer. Simulates small buffer reuse to help test that readers aren't
 * holding onto buffers without copying them.
 */
function makeReadable(data: Uint8Array) {
  let readCalls = 0;
  const reusableBuffer = new Uint8Array(data.byteLength);
  return {
    get readCalls() {
      return readCalls;
    },
    size: async () => BigInt(data.length),
    read: async (offset: bigint, size: bigint) => {
      ++readCalls;
      if (offset > Number.MAX_SAFE_INTEGER || size > Number.MAX_SAFE_INTEGER) {
        throw new Error(`Read too large: offset ${offset}, size ${size}`);
      }
      if (offset < 0 || size < 0 || offset + size > data.length) {
        throw new Error(
          `Read out of range: offset ${offset}, size ${size} (data.length: ${data.length})`,
        );
      }
      reusableBuffer.set(
        new Uint8Array(data.buffer, data.byteOffset + Number(offset), Number(size)),
      );
      reusableBuffer.fill(0xff, Number(size));
      return new Uint8Array(reusableBuffer.buffer, 0, Number(size));
    },
  };
}

function writeChunkWithMessageIndexes(
  builder: McapRecordBuilder,
  chunk: ChunkBuilder,
): TypedMcapRecords["ChunkIndex"] {
  const chunkStartOffset = BigInt(builder.length);
  const chunkLength = builder.writeChunk({
    messageStartTime: chunk.messageStartTime,
    messageEndTime: chunk.messageEndTime,
    uncompressedSize: BigInt(chunk.buffer.length),
    uncompressedCrc: 0,
    compression: "",
    records: chunk.buffer,
  });

  const messageIndexStart = BigInt(builder.length);
  let messageIndexLength = 0n;
  const chunkMessageIndexOffsets = new Map<number, bigint>();
  for (const messageIndex of chunk.indices) {
    chunkMessageIndexOffsets.set(messageIndex.channelId, messageIndexStart + messageIndexLength);
    messageIndexLength += builder.writeMessageIndex(messageIndex);
  }

  return {
    type: "ChunkIndex",
    messageStartTime: chunk.messageStartTime,
    messageEndTime: chunk.messageEndTime,
    chunkStartOffset,
    chunkLength,
    messageIndexOffsets: chunkMessageIndexOffsets,
    messageIndexLength,
    compression: "",
    compressedSize: BigInt(chunk.buffer.byteLength),
    uncompressedSize: BigInt(chunk.buffer.byteLength),
  };
}

describe("McapIndexedReader", () => {
  describe("chunks without message indexes", () => {
    const channels: TypedMcapRecords["Channel"][] = [1, 2].map((id) => ({
      type: "Channel",
      id,
      schemaId: 0,
      topic: id === 1 ? "a" : "b",
      messageEncoding: "json",
      metadata: new Map(),
    }));
    const message = (channelId: number, logTime: bigint): TypedMcapRecords["Message"] => ({
      type: "Message",
      channelId,
      sequence: Number(logTime),
      logTime,
      publishTime: logTime,
      data: new Uint8Array([Number(logTime)]),
    });

    /** Writes a chunk and a chunk index without message indexes, as the spec allows */
    function writeUnindexedChunk(
      builder: McapRecordBuilder,
      chunk: ChunkBuilder,
      times: [bigint, bigint] = [chunk.messageStartTime, chunk.messageEndTime],
    ): TypedMcapRecords["ChunkIndex"] {
      const index = writeChunkWithMessageIndexes(new McapRecordBuilder(), chunk);
      const chunkStartOffset = BigInt(builder.length);
      const chunkLength = builder.writeChunk({
        messageStartTime: times[0],
        messageEndTime: times[1],
        uncompressedSize: BigInt(chunk.buffer.length),
        uncompressedCrc: 0,
        compression: "",
        records: chunk.buffer,
      });
      return {
        ...index,
        messageStartTime: times[0],
        messageEndTime: times[1],
        chunkStartOffset,
        chunkLength,
        messageIndexOffsets: new Map(),
        messageIndexLength: 0n,
      };
    }

    async function makeReader(chunkCache?: ChunkDataCache) {
      // Unindexed, messages out of time order across two channels
      const unindexed = new ChunkBuilder({ useMessageIndex: false });
      channels.forEach((channel) => {
        unindexed.addChannel(channel);
      });
      for (const [channelId, logTime] of [
        [1, 3n],
        [2, 1n],
        [1, 6n],
        [2, 4n],
      ] as const) {
        unindexed.addMessage(message(channelId, logTime));
      }
      // Indexed, overlapping the unindexed one in time
      const indexed = new ChunkBuilder({ useMessageIndex: true });
      indexed.addChannel(channels[0]!);
      indexed.addMessage(message(1, 2n));
      indexed.addMessage(message(1, 5n));

      const builder = new McapRecordBuilder();
      builder.writeMagic();
      builder.writeHeader({ profile: "", library: "" });
      const chunkIndexes = [
        writeUnindexedChunk(builder, unindexed),
        writeChunkWithMessageIndexes(builder, indexed),
        // Empty, with times that aren't zero
        writeUnindexedChunk(builder, new ChunkBuilder({ useMessageIndex: false }), [2n, 3n]),
      ];
      builder.writeDataEnd({ dataSectionCrc: 0 });
      const summaryStart = BigInt(builder.length);
      channels.forEach((channel) => builder.writeChannel(channel));
      chunkIndexes.forEach((index) => builder.writeChunkIndex(index));
      builder.writeFooter({ summaryStart, summaryOffsetStart: 0n, summaryCrc: 0 });
      builder.writeMagic();
      return await McapIndexedReader.Initialize({
        readable: makeReadable(builder.buffer),
        chunkCache,
      });
    }

    const times = (messages: TypedMcapRecords["Message"][]) =>
      messages.map((msg) => [msg.channelId, msg.logTime]);

    it("reads them by scanning the chunk, in time order", async () => {
      const reader = await makeReader();
      const forward = [
        [2, 1n],
        [1, 2n],
        [1, 3n],
        [2, 4n],
        [1, 5n],
        [1, 6n],
      ];
      expect(times(await collect(reader.readMessages()))).toEqual(forward);
      expect(times(await collect(reader.readMessages({ reverse: true })))).toEqual(
        forward.reverse(),
      );
      await expect(collect(reader.readMessages())).resolves.toContainEqual(message(2, 4n));
    });

    it("filters them by topic and time", async () => {
      const reader = await makeReader();
      expect(times(await collect(reader.readMessages({ topics: ["b"] })))).toEqual([
        [2, 1n],
        [2, 4n],
      ]);
      expect(
        times(await collect(reader.readMessages({ topics: ["a"], reverse: true, endingAt: 5n }))),
      ).toEqual([
        [1, 5n],
        [1, 3n],
        [1, 2n],
      ]);
      expect(times(await collect(reader.readMessages({ startingAt: 3n, endingAt: 4n })))).toEqual([
        [1, 3n],
        [2, 4n],
      ]);
    });

    it("caches the scanned index", async () => {
      const views = new Map<bigint, DataView>();
      const indexes = new Map<bigint, ChunkMessageIndex>();
      const cache = {
        get: (offset: bigint) => views.get(offset),
        set: (offset: bigint, view: DataView) => views.set(offset, view),
        getChunkMessageIndex: (offset: bigint) => indexes.get(offset),
        setChunkMessageIndex: (offset: bigint, index: ChunkMessageIndex) =>
          indexes.set(offset, index),
      };
      const reader = await makeReader(cache);
      const first = await collect(reader.readMessages());
      expect(indexes.has(reader.chunkIndexes[0]!.chunkStartOffset)).toBe(true);
      await expect(collect(reader.readMessages())).resolves.toEqual(first);
    });
  });

  it("rejects files that are too small", async () => {
    await expect(
      McapIndexedReader.Initialize({
        readable: makeReadable(
          new Uint8Array([
            ...MCAP_MAGIC,
            ...record(Opcode.FOOTER, [
              ...uint64LE(0n), // summary start
              ...uint64LE(0n), // summary offset start
              ...uint32LE(0), // summary crc
            ]),
            ...MCAP_MAGIC,
          ]),
        ),
      }),
    ).rejects.toThrow("Unable to read header at beginning of file; found Footer");

    await expect(
      McapIndexedReader.Initialize({
        readable: makeReadable(
          new Uint8Array([
            ...MCAP_MAGIC,
            ...record(Opcode.HEADER, [
              ...string(""), // profile
              ...string(""), // library
            ]),
            ...MCAP_MAGIC,
          ]),
        ),
      }),
    ).rejects.toThrow("too small to be valid MCAP");
  });

  it("rejects unindexed file", async () => {
    const readable = makeReadable(
      new Uint8Array([
        ...MCAP_MAGIC,
        ...record(Opcode.HEADER, [
          ...string(""), // profile
          ...string(""), // library
        ]),
        ...record(Opcode.FOOTER, [
          ...uint64LE(0n), // summary start
          ...uint64LE(0n), // summary offset start
          ...uint32LE(0), // summary crc
        ]),
        ...MCAP_MAGIC,
      ]),
    );
    await expect(McapIndexedReader.Initialize({ readable })).rejects.toThrow("File is not indexed");
  });

  it("includes library in error messages", async () => {
    const readable = makeReadable(
      new Uint8Array([
        ...MCAP_MAGIC,
        ...record(Opcode.HEADER, [
          ...string(""), // profile
          ...string("lib"), // library
        ]),
        ...record(Opcode.FOOTER, [
          ...uint64LE(0n), // summary start
          ...uint64LE(0n), // summary offset start
          ...uint32LE(0), // summary crc
        ]),
        ...MCAP_MAGIC,
      ]),
    );
    await expect(McapIndexedReader.Initialize({ readable })).rejects.toThrow(
      "File is not indexed [library=lib]",
    );
  });

  it("rejects invalid index crc", async () => {
    const data = [
      ...MCAP_MAGIC,
      ...record(Opcode.HEADER, [
        ...string(""), // profile
        ...string(""), // library
      ]),
      ...record(Opcode.DATA_END, [...uint32LE(0)]),
    ];
    const summaryStart = data.length;

    data.push(
      ...record(Opcode.METADATA, [
        ...string("foobar"),
        ...keyValues(string, string, []), // metadata
      ]),
    );

    data.push(
      ...record(Opcode.FOOTER, [
        ...uint64LE(BigInt(summaryStart)), // summary start
        ...uint64LE(0n), // summary offset start
        ...uint32LE(crc32(new Uint8Array([42]))), // summary crc
      ]),
      ...MCAP_MAGIC,
    );
    const readable = makeReadable(new Uint8Array(data));
    await expect(McapIndexedReader.Initialize({ readable })).rejects.toThrow(
      "Incorrect summary CRC 1656343536 (expected 163128923)",
    );
  });

  it("parses index with schema and channel", async () => {
    const data = [
      ...MCAP_MAGIC,
      ...record(Opcode.HEADER, [
        ...string(""), // profile
        ...string(""), // library
      ]),
      ...record(Opcode.DATA_END, [...uint32LE(0)]),
    ];
    const summaryStart = data.length;
    data.push(
      ...record(Opcode.SCHEMA, [
        ...uint16LE(1), // schema id
        ...string("some data"), // schema name
        ...string("json"), // schema format
        ...uint32PrefixedBytes(new TextEncoder().encode("stuff")), // schema
      ]),
      ...record(Opcode.CHANNEL, [
        ...uint16LE(42), // channel id
        ...uint16LE(1), // schema id
        ...string("myTopic"), // topic
        ...string("utf12"), // encoding
        ...keyValues(string, string, [["foo", "bar"]]), // user data
      ]),
      ...record(Opcode.FOOTER, [
        ...uint64LE(BigInt(summaryStart)), // summary start
        ...uint64LE(0n), // summary offset start
        ...uint32LE(crc32(new Uint8Array(0))), // summary crc
      ]),
      ...MCAP_MAGIC,
    );
    const readable = makeReadable(new Uint8Array(data));
    const reader = await McapIndexedReader.Initialize({ readable });
    await expect(collect(reader.readMessages())).resolves.toEqual([]);
    expect(reader.channelsById).toEqual(
      new Map<number, TypedMcapRecords["Channel"]>([
        [
          42,
          {
            type: "Channel",
            id: 42,
            schemaId: 1,
            topic: "myTopic",
            messageEncoding: "utf12",
            metadata: new Map([["foo", "bar"]]),
          },
        ],
      ]),
    );
    expect(reader.schemasById).toEqual(
      new Map<number, TypedMcapRecords["Schema"]>([
        [
          1,
          {
            type: "Schema",
            id: 1,
            name: "some data",
            encoding: "json",
            data: new TextEncoder().encode("stuff"),
          },
        ],
      ]),
    );
    expect(readable.readCalls).toBe(4);
  });

  describe("indexed with single channel", () => {
    const message1: TypedMcapRecords["Message"] = {
      type: "Message",
      channelId: 42,
      sequence: 1,
      publishTime: 0n,
      logTime: 10n,
      data: new Uint8Array(),
    };
    const message2: TypedMcapRecords["Message"] = {
      type: "Message",
      channelId: 42,
      sequence: 2,
      publishTime: 1n,
      logTime: 11n,
      data: new Uint8Array(),
    };
    const message3: TypedMcapRecords["Message"] = {
      type: "Message",
      channelId: 42,
      sequence: 3,
      publishTime: 2n,
      logTime: 12n,
      data: new Uint8Array(),
    };
    it.each([
      { startingAt: undefined, endingAt: undefined, expected: [message1, message2, message3] },
      { startingAt: 11n, endingAt: 11n, expected: [message2] },
      { startingAt: 11n, endingAt: undefined, expected: [message2, message3] },
      { startingAt: undefined, endingAt: 11n, expected: [message1, message2] },
      { startingAt: 10n, endingAt: 12n, expected: [message1, message2, message3] },
    ])(
      "fetches chunk data and reads requested messages between $startingAt and $endingAt",
      async ({ startingAt, endingAt, expected }) => {
        const schema = record(Opcode.SCHEMA, [
          ...uint16LE(1), // schema id
          ...string("some data"), // schema name
          ...string("json"), // schema format
          ...uint32PrefixedBytes(new TextEncoder().encode("stuff")), // schema
        ]);
        const channel = record(Opcode.CHANNEL, [
          ...uint16LE(42), // channel id
          ...uint16LE(1), // schema id
          ...string("myTopic"), // topic
          ...string("utf12"), // message encoding
          ...keyValues(string, string, [["foo", "bar"]]), // user data
        ]);
        const message1Data = record(Opcode.MESSAGE, [
          ...uint16LE(message1.channelId),
          ...uint32LE(message1.sequence),
          ...uint64LE(message1.logTime),
          ...uint64LE(message1.publishTime),
        ]);
        const message2Data = record(Opcode.MESSAGE, [
          ...uint16LE(message2.channelId),
          ...uint32LE(message2.sequence),
          ...uint64LE(message2.logTime),
          ...uint64LE(message2.publishTime),
        ]);
        const message3Data = record(Opcode.MESSAGE, [
          ...uint16LE(message3.channelId),
          ...uint32LE(message3.sequence),
          ...uint64LE(message3.logTime),
          ...uint64LE(message3.publishTime),
        ]);
        const chunkContents = [...schema, ...channel];
        const message1Offset = BigInt(chunkContents.length);
        chunkContents.push(...message1Data);
        const message2Offset = BigInt(chunkContents.length);
        chunkContents.push(...message2Data);
        const message3Offset = BigInt(chunkContents.length);
        chunkContents.push(...message3Data);

        const data = [
          ...MCAP_MAGIC,
          ...record(Opcode.HEADER, [
            ...string(""), // profile
            ...string(""), // library
          ]),
        ];
        const chunkOffset = BigInt(data.length);
        data.push(
          ...record(Opcode.CHUNK, [
            ...uint64LE(0n), // start time
            ...uint64LE(0n), // end time
            ...uint64LE(0n), // decompressed size
            ...uint32LE(crc32(new Uint8Array(chunkContents))), // decompressed crc32
            ...string(""), // compression
            ...uint64LE(BigInt(chunkContents.length)),
            ...chunkContents,
          ]),
        );
        const chunkLength = BigInt(data.length) - chunkOffset;
        const messageIndexOffset = BigInt(data.length);
        data.push(
          ...record(Opcode.MESSAGE_INDEX, [
            ...uint16LE(42), // channel id
            ...keyValues(uint64LE, uint64LE, [
              [message1.logTime, message1Offset],
              [message2.logTime, message2Offset],
              [message3.logTime, message3Offset],
            ]), // records
          ]),
        );
        const messageIndexLength = BigInt(data.length) - messageIndexOffset;
        data.push(...record(Opcode.DATA_END, [...uint32LE(0)]));
        const summaryStart = data.length;
        data.push(
          ...channel,
          ...record(Opcode.CHUNK_INDEX, [
            ...uint64LE(message1.logTime), // start time
            ...uint64LE(message3.logTime), // end time
            ...uint64LE(chunkOffset), // offset
            ...uint64LE(chunkLength), // chunk length
            ...keyValues(uint16LE, uint64LE, [[42, messageIndexOffset]]), // message index offsets
            ...uint64LE(messageIndexLength), // message index length
            ...string(""), // compression
            ...uint64LE(BigInt(chunkContents.length)), // compressed size
            ...uint64LE(BigInt(chunkContents.length)), // uncompressed size
          ]),
          ...record(Opcode.FOOTER, [
            ...uint64LE(BigInt(summaryStart)), // summary start
            ...uint64LE(0n), // summary offset start
            ...uint32LE(crc32(new Uint8Array(0))), // summary crc
          ]),
          ...MCAP_MAGIC,
        );

        {
          const readable = makeReadable(new Uint8Array(data));
          const reader = await McapIndexedReader.Initialize({ readable });
          const collected = await collect(reader.readMessages({ startingAt, endingAt }));
          expect(collected).toEqual(expected);
          expect(readable.readCalls).toBe(6);
        }

        {
          const readable = makeReadable(new Uint8Array(data));
          const reader = await McapIndexedReader.Initialize({ readable });
          const collected = await collect(
            reader.readMessages({ startingAt, endingAt, reverse: true }),
          );
          expect(collected).toEqual(expected.reverse());
          expect(readable.readCalls).toBe(6);
        }
      },
    );
  });

  describe("indexed with multiple channels", () => {
    const messages = [
      {
        type: "Message",
        sequence: 1,
        publishTime: 0n,
        logTime: 10n,
        data: new Uint8Array(),
      },
      {
        type: "Message",
        sequence: 2,
        publishTime: 1n,
        logTime: 11n,
        data: new Uint8Array(),
      },
    ];
    it.each([
      { startingAt: undefined, endingAt: undefined, expectedIndices: [0, 1] },
      { startingAt: undefined, endingAt: 10n, expectedIndices: [0] },
      { startingAt: 11n, endingAt: 11n, expectedIndices: [1] },
      { startingAt: 11n, endingAt: undefined, expectedIndices: [1] },
      { startingAt: undefined, endingAt: 11n, expectedIndices: [0, 1] },
      { startingAt: 10n, endingAt: 12n, expectedIndices: [0, 1] },
    ])(
      "fetches chunk data and reads requested messages between $startingAt and $endingAt",
      async ({ startingAt, endingAt, expectedIndices }) => {
        const tempBuffer = new TempBuffer();
        const writer = new McapWriter({ writable: tempBuffer });
        await writer.start({ library: "", profile: "" });
        const channelId1 = await writer.registerChannel({
          topic: "test1",
          schemaId: 0,
          messageEncoding: "json",
          metadata: new Map(),
        });
        const channelId2 = await writer.registerChannel({
          topic: "test2",
          schemaId: 0,
          messageEncoding: "json",
          metadata: new Map(),
        });
        const channelIds = [channelId1, channelId2];
        await writer.addMessage({ channelId: channelId1, ...messages[0]! });
        await writer.addMessage({ channelId: channelId2, ...messages[1]! });
        await writer.end();

        {
          const reader = await McapIndexedReader.Initialize({ readable: tempBuffer });
          const collected = await collect(reader.readMessages({ startingAt, endingAt }));
          expect(collected).toEqual(
            expectedIndices.map((i) => ({ channelId: channelIds[i]!, ...messages[i]! })),
          );
        }

        {
          const reader = await McapIndexedReader.Initialize({ readable: tempBuffer });
          const collected = await collect(
            reader.readMessages({ startingAt, endingAt, reverse: true }),
          );
          expect(collected).toEqual(
            expectedIndices.map((i) => ({ channelId: channelIds[i]!, ...messages[i]! })).reverse(),
          );
        }
      },
    );

    it("supports explicit time range bounds", async () => {
      const tempBuffer = new TempBuffer();
      const writer = new McapWriter({ writable: tempBuffer });
      await writer.start({ library: "", profile: "" });
      const channelId1 = await writer.registerChannel({
        topic: "test1",
        schemaId: 0,
        messageEncoding: "json",
        metadata: new Map(),
      });
      const channelId2 = await writer.registerChannel({
        topic: "test2",
        schemaId: 0,
        messageEncoding: "json",
        metadata: new Map(),
      });
      const channelIds = [channelId1, channelId2];
      await writer.addMessage({ channelId: channelId1, ...messages[0]! });
      await writer.addMessage({ channelId: channelId2, ...messages[1]! });
      await writer.end();

      const readWith = async (args: {
        startingAt?: bigint;
        startingAfter?: bigint;
        endingAt?: bigint;
        endingBefore?: bigint;
      }) => {
        const reader = await McapIndexedReader.Initialize({ readable: tempBuffer });
        return await collect(reader.readMessages(args));
      };

      const expectIndices = (indices: number[]) =>
        indices.map((i) => ({ channelId: channelIds[i]!, ...messages[i]! }));

      // Messages have log times 10 and 11. Inclusive and exclusive bounds on both sides:
      await expect(readWith({ startingAt: 10n, endingAt: 11n })).resolves.toEqual(
        expectIndices([0, 1]),
      );
      await expect(readWith({ startingAt: 10n, endingBefore: 11n })).resolves.toEqual(
        expectIndices([0]),
      );
      await expect(readWith({ startingAfter: 10n, endingAt: 11n })).resolves.toEqual(
        expectIndices([1]),
      );
      // Equal inclusive bounds select the single matching log time.
      await expect(readWith({ startingAt: 10n, endingAt: 10n })).resolves.toEqual(
        expectIndices([0]),
      );
      // A crossed range throws; an empty range or a bound beyond the file's range does not.
      await expect(readWith({ startingAt: 11n, endingBefore: 10n })).rejects.toThrow(
        "end time cannot come before start time",
      );
      await expect(readWith({ startingAt: 11n, endingBefore: 11n })).resolves.toEqual(
        expectIndices([]),
      );
      await expect(readWith({ startingAt: 99n })).resolves.toEqual(expectIndices([]));
      // At most one bound per side may be provided.
      await expect(readWith({ startingAt: 10n, startingAfter: 10n })).rejects.toThrow(
        "at most one of startingAt, startingAfter",
      );
      await expect(readWith({ endingAt: 11n, endingBefore: 11n })).rejects.toThrow(
        "at most one of endingAt, endingBefore",
      );
    });

    it("keeps every message at an inclusive bound shared by several messages", async () => {
      const tempBuffer = new TempBuffer();
      // A zero chunk size puts every message in its own chunk, so the duplicates span chunks.
      const writer = new McapWriter({ writable: tempBuffer, chunkSize: 0 });
      await writer.start({ library: "", profile: "" });
      const channelId = await writer.registerChannel({
        topic: "test",
        schemaId: 0,
        messageEncoding: "json",
        metadata: new Map(),
      });
      const written = [2n, 3n, 3n, 3n, 4n].map((logTime, i) => ({
        type: "Message" as const,
        channelId,
        sequence: i,
        publishTime: logTime,
        logTime,
        data: new Uint8Array(),
      }));
      for (const message of written) {
        await writer.addMessage(message);
      }
      await writer.end();

      const reader = await McapIndexedReader.Initialize({ readable: tempBuffer });
      expect(reader.chunkIndexes).toHaveLength(written.length);

      for (const reverse of [false, true]) {
        const readWith = async (args: {
          startingAt?: bigint;
          startingAfter?: bigint;
          endingAt?: bigint;
          endingBefore?: bigint;
        }) => await collect(reader.readMessages({ ...args, reverse }));
        const expected = (indices: number[]) => {
          const picked = indices.map((i) => written[i]!);
          return reverse ? picked.reverse() : picked;
        };
        // Equal inclusive bounds keep every message at that log time, across chunks.
        await expect(readWith({ startingAt: 3n, endingAt: 3n })).resolves.toEqual(
          expected([1, 2, 3]),
        );
        // The exclusive spellings drop every one of them.
        await expect(readWith({ startingAfter: 3n })).resolves.toEqual(expected([4]));
        await expect(readWith({ endingBefore: 3n })).resolves.toEqual(expected([0]));
      }
    });

    it("includes a message logged at the maximum timestamp", async () => {
      const maxTime = 2n ** 64n - 1n;
      const tempBuffer = new TempBuffer();
      const writer = new McapWriter({ writable: tempBuffer });
      await writer.start({ library: "", profile: "" });
      const channelId = await writer.registerChannel({
        topic: "test1",
        schemaId: 0,
        messageEncoding: "json",
        metadata: new Map(),
      });
      await writer.addMessage({ channelId, ...messages[0]! });
      await writer.addMessage({ channelId, ...messages[1]!, logTime: maxTime });
      await writer.end();

      const reader = await McapIndexedReader.Initialize({ readable: tempBuffer });
      const collectedDefault = await collect(reader.readMessages());
      expect(collectedDefault.map((m) => m.logTime)).toEqual([10n, maxTime]);
      const collectedBounded = await collect(reader.readMessages({ endingAt: maxTime }));
      expect(collectedBounded.map((m) => m.logTime)).toEqual([10n, maxTime]);
      // No log time is strictly after the maximum timestamp.
      const collectedAfterMax = await collect(reader.readMessages({ startingAfter: maxTime }));
      expect(collectedAfterMax).toEqual([]);
      // With an end bound that also reaches the maximum it is still an empty query.
      const collectedAfterMaxBounded = await collect(
        reader.readMessages({ startingAfter: maxTime, endingAt: maxTime }),
      );
      expect(collectedAfterMaxBounded).toEqual([]);
      // An end bound that stops short of the maximum makes the range crossed, as it does for
      // an inclusive lower bound at the maximum.
      for (const args of [
        { startingAfter: maxTime, endingBefore: 5n },
        { startingAfter: maxTime, endingAt: 5n },
        { startingAt: maxTime, endingBefore: 5n },
      ]) {
        await expect(collect(reader.readMessages(args))).rejects.toThrow(
          "end time cannot come before start time",
        );
      }
      // startingAfter below the maximum keeps its normal exclusive behavior.
      const collectedAfter = await collect(reader.readMessages({ startingAfter: 10n }));
      expect(collectedAfter.map((m) => m.logTime)).toEqual([maxTime]);
    });
  });

  it("sorts and merges out-of-order and overlapping chunks", async () => {
    const channel1: TypedMcapRecord = {
      type: "Channel",
      id: 1,
      schemaId: 0,
      topic: "a",
      messageEncoding: "utf12",
      metadata: new Map(),
    };
    const makeMessage = (idx: number): TypedMcapRecords["Message"] => {
      return {
        type: "Message",
        channelId: channel1.id,
        sequence: idx,
        logTime: BigInt(idx),
        publishTime: 0n,
        data: new Uint8Array(),
      };
    };
    const message1 = makeMessage(1);
    const message2 = makeMessage(2);
    const message3 = makeMessage(3);
    const message4 = makeMessage(4);
    const message5 = makeMessage(5);
    const message6 = makeMessage(6);

    const chunk1 = new ChunkBuilder({ useMessageIndex: true });
    chunk1.addChannel(channel1);
    chunk1.addMessage(message6);

    const chunk2 = new ChunkBuilder({ useMessageIndex: true });
    chunk2.addChannel(channel1);
    chunk2.addMessage(message2);
    chunk2.addMessage(message5);

    const chunk3 = new ChunkBuilder({ useMessageIndex: true });
    chunk3.addChannel(channel1);
    chunk3.addMessage(message4);
    chunk3.addMessage(message3);

    const chunk4 = new ChunkBuilder({ useMessageIndex: true });
    chunk4.addChannel(channel1);
    chunk4.addMessage(message1);

    const builder = new McapRecordBuilder();
    builder.writeMagic();
    builder.writeHeader({ profile: "", library: "" });

    const chunkIndexes: TypedMcapRecords["ChunkIndex"][] = [];
    chunkIndexes.push(writeChunkWithMessageIndexes(builder, chunk1));
    chunkIndexes.push(writeChunkWithMessageIndexes(builder, chunk2));
    chunkIndexes.push(writeChunkWithMessageIndexes(builder, chunk3));
    chunkIndexes.push(writeChunkWithMessageIndexes(builder, chunk4));

    builder.writeDataEnd({ dataSectionCrc: 0 });

    const summaryStart = BigInt(builder.length);

    for (const index of chunkIndexes) {
      builder.writeChunkIndex(index);
    }

    builder.writeFooter({ summaryStart, summaryOffsetStart: 0n, summaryCrc: 0 });
    builder.writeMagic();

    const reader = await McapIndexedReader.Initialize({ readable: makeReadable(builder.buffer) });
    await expect(collect(reader.readMessages())).resolves.toEqual([
      message1,
      message2,
      message3,
      message4,
      message5,
      message6,
    ]);
  });

  it("merges many overlapping chunks in any file order like a full sort", async () => {
    // Deterministic pseudo-random layout: chunks overlap, repeat log times and come out of order
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return Math.floor(seed / 2 ** 16) % n;
    };
    const channels = [1, 2].map((id): TypedMcapRecords["Channel"] => ({
      type: "Channel",
      id,
      schemaId: 0,
      topic: `t${id}`,
      messageEncoding: "utf12",
      metadata: new Map(),
    }));
    const builder = new McapRecordBuilder();
    builder.writeMagic();
    builder.writeHeader({ profile: "", library: "" });
    const chunkIndexes: TypedMcapRecords["ChunkIndex"][] = [];
    // File order of every message, the full sort's last tie-breaker
    const written: TypedMcapRecords["Message"][] = [];
    for (let c = 0; c < 40; c++) {
      const chunk = new ChunkBuilder({ useMessageIndex: true });
      channels.forEach((channel) => {
        chunk.addChannel(channel);
      });
      const base = random(80);
      for (let m = 0, count = 1 + random(5); m < count; m++) {
        const message: TypedMcapRecords["Message"] = {
          type: "Message",
          channelId: channels[random(2)]!.id,
          sequence: written.length,
          logTime: BigInt(base + random(20)),
          publishTime: 0n,
          data: new Uint8Array(),
        };
        chunk.addMessage(message);
        written.push(message);
      }
      chunkIndexes.push(writeChunkWithMessageIndexes(builder, chunk));
    }
    builder.writeDataEnd({ dataSectionCrc: 0 });
    const summaryStart = BigInt(builder.length);
    channels.forEach((channel) => builder.writeChannel(channel));
    for (const index of chunkIndexes) {
      builder.writeChunkIndex(index);
    }
    builder.writeFooter({ summaryStart, summaryOffsetStart: 0n, summaryCrc: 0 });
    builder.writeMagic();
    const reader = await McapIndexedReader.Initialize({ readable: makeReadable(builder.buffer) });

    // By log time, then file order (chunks and the messages in them are written in file order)
    const sorted = [...written].sort((a, b) => Number(a.logTime - b.logTime));
    const ranges: { startingAt?: bigint; endingAt?: bigint; topics?: string[] }[] = [
      {},
      { startingAt: 30n, endingAt: 60n },
      { startingAt: 50n, topics: ["t2"] },
      { endingAt: 20n, topics: ["t1"] },
    ];
    for (const args of ranges) {
      const expected = sorted.filter(
        (message) =>
          message.logTime >= (args.startingAt ?? 0n) &&
          message.logTime <= (args.endingAt ?? 1000n) &&
          (args.topics?.includes(`t${message.channelId}`) ?? true),
      );
      expect(expected.length).toBeGreaterThan(0);
      await expect(collect(reader.readMessages(args))).resolves.toEqual(expected);
      await expect(collect(reader.readMessages({ ...args, reverse: true }))).resolves.toEqual(
        [...expected].reverse(),
      );
    }
  });

  it("supports reading topics that only occur in some chunks", async () => {
    const channel1: TypedMcapRecords["Channel"] = {
      type: "Channel",
      id: 1,
      schemaId: 0,
      topic: "a",
      messageEncoding: "utf12",
      metadata: new Map(),
    };
    const channel2: TypedMcapRecords["Channel"] = {
      type: "Channel",
      id: 2,
      schemaId: 0,
      topic: "b",
      messageEncoding: "utf13",
      metadata: new Map(),
    };

    const message1: TypedMcapRecords["Message"] = {
      type: "Message",
      channelId: channel1.id,
      sequence: 0,
      logTime: 0n,
      publishTime: 0n,
      data: new Uint8Array(),
    };
    const message2: TypedMcapRecords["Message"] = {
      type: "Message",
      channelId: channel2.id,
      sequence: 0,
      logTime: 1n,
      publishTime: 1n,
      data: new Uint8Array(),
    };

    const chunk1 = new ChunkBuilder({ useMessageIndex: true });
    chunk1.addChannel(channel1);
    chunk1.addMessage(message1);

    const chunk2 = new ChunkBuilder({ useMessageIndex: true });
    chunk2.addChannel(channel2);
    chunk2.addMessage(message2);

    const builder = new McapRecordBuilder();
    builder.writeMagic();
    builder.writeHeader({ profile: "", library: "" });

    const chunkIndexes: TypedMcapRecords["ChunkIndex"][] = [];
    chunkIndexes.push(writeChunkWithMessageIndexes(builder, chunk1));
    chunkIndexes.push(writeChunkWithMessageIndexes(builder, chunk2));

    builder.writeDataEnd({ dataSectionCrc: 0 });

    const summaryStart = BigInt(builder.length);
    builder.writeChannel(channel1);
    builder.writeChannel(channel2);
    for (const index of chunkIndexes) {
      builder.writeChunkIndex(index);
    }

    builder.writeFooter({ summaryStart, summaryOffsetStart: 0n, summaryCrc: 0 });
    builder.writeMagic();

    const reader = await McapIndexedReader.Initialize({ readable: makeReadable(builder.buffer) });
    await expect(collect(reader.readMessages({ topics: ["b"] }))).resolves.toEqual([message2]);
  });

  it("uses stable sort when loading overlapping chunks", async () => {
    const channel1: TypedMcapRecord = {
      type: "Channel",
      id: 1,
      schemaId: 0,
      topic: "a",
      messageEncoding: "utf12",
      metadata: new Map(),
    };
    const makeMessage = (idx: number): TypedMcapRecords["Message"] => {
      return {
        type: "Message",
        channelId: channel1.id,
        sequence: idx,
        logTime: BigInt(idx),
        publishTime: 0n,
        data: new Uint8Array(),
      };
    };

    const message3 = makeMessage(3);
    const message4 = makeMessage(4);
    const message5 = makeMessage(5);
    const message6 = makeMessage(6);

    /* Chunks have this layout:
      1: [3       6]
      2:   [4]
      3:      [5]
    */

    const chunk1 = new ChunkBuilder({ useMessageIndex: true });
    chunk1.addChannel(channel1);
    chunk1.addMessage(message3);
    chunk1.addMessage(message6);

    const chunk2 = new ChunkBuilder({ useMessageIndex: true });
    chunk2.addChannel(channel1);
    chunk2.addMessage(message4);

    const chunk3 = new ChunkBuilder({ useMessageIndex: true });
    chunk3.addChannel(channel1);
    chunk3.addMessage(message5);

    const builder = new McapRecordBuilder();
    builder.writeMagic();
    builder.writeHeader({ profile: "", library: "" });

    const chunkIndexes: TypedMcapRecords["ChunkIndex"][] = [];
    chunkIndexes.push(writeChunkWithMessageIndexes(builder, chunk1));
    chunkIndexes.push(writeChunkWithMessageIndexes(builder, chunk2));
    chunkIndexes.push(writeChunkWithMessageIndexes(builder, chunk3));

    builder.writeDataEnd({ dataSectionCrc: 0 });

    const summaryStart = BigInt(builder.length);

    for (const index of chunkIndexes) {
      builder.writeChunkIndex(index);
    }

    builder.writeFooter({ summaryStart, summaryOffsetStart: 0n, summaryCrc: 0 });
    builder.writeMagic();

    for (const reverse of [true, false]) {
      let expected = [message3, message4, message5, message6];
      if (reverse) {
        expected = expected.reverse();
      }

      const readable = makeReadable(builder.buffer);
      const reader = await McapIndexedReader.Initialize({ readable });
      expect(readable.readCalls).toEqual(4);

      const messageIter = reader.readMessages({ reverse });
      expect(readable.readCalls).toEqual(4);

      const collected = [];

      collected.push((await messageIter.next()).value);
      expect(readable.readCalls).toEqual(6);
      collected.push((await messageIter.next()).value);
      expect(readable.readCalls).toEqual(8);
      collected.push((await messageIter.next()).value);
      expect(readable.readCalls).toEqual(10);
      collected.push((await messageIter.next()).value);
      expect(readable.readCalls).toEqual(10);

      expect(collected).toEqual(expected);
    }
  });

  it("handles multiple messages at same timestamp", async () => {
    const tempBuffer = new TempBuffer();
    const writer = new McapWriter({ writable: tempBuffer });
    await writer.start({ library: "", profile: "" });
    const channelId1 = await writer.registerChannel({
      topic: "test1",
      schemaId: 0,
      messageEncoding: "",
      metadata: new Map(),
    });
    const message1: TypedMcapRecords["Message"] = {
      type: "Message",
      channelId: channelId1,
      sequence: 1,
      logTime: 0n,
      publishTime: 0n,
      data: new Uint8Array([1]),
    };
    const message2: TypedMcapRecords["Message"] = {
      type: "Message",
      channelId: channelId1,
      sequence: 2,
      logTime: 0n,
      publishTime: 0n,
      data: new Uint8Array([2]),
    };
    const message3: TypedMcapRecords["Message"] = {
      type: "Message",
      channelId: channelId1,
      sequence: 3,
      logTime: 0n,
      publishTime: 0n,
      data: new Uint8Array([3]),
    };
    await writer.addMessage(message1);
    await writer.addMessage(message2);
    await writer.addMessage(message3);
    await writer.end();

    for (const reverse of [true, false]) {
      let expected = [message1, message2, message3];
      if (reverse) {
        expected = expected.reverse();
      }

      const reader = await McapIndexedReader.Initialize({ readable: tempBuffer });

      expect(await collect(reader.readMessages({ reverse }))).toEqual(expected);
    }
  });

  it("ensure that chunks are loaded only when needed", async () => {
    const channelA: TypedMcapRecord = {
      type: "Channel",
      id: 1,
      schemaId: 0,
      topic: "a",
      messageEncoding: "utf12",
      metadata: new Map(),
    };
    const channelB: TypedMcapRecord = {
      type: "Channel",
      id: 2,
      schemaId: 0,
      topic: "b",
      messageEncoding: "utf12",
      metadata: new Map(),
    };
    const makeMessage = (channel: Channel, idx: number): TypedMcapRecords["Message"] => {
      return {
        type: "Message",
        channelId: channel.id,
        sequence: idx,
        logTime: BigInt(idx),
        publishTime: 0n,
        data: new Uint8Array(),
      };
    };

    const messageA1 = makeMessage(channelA, 1);
    const messageB1 = makeMessage(channelB, 1);
    const messageB2 = makeMessage(channelB, 2);

    const chunk1 = new ChunkBuilder({ useMessageIndex: true });
    chunk1.addChannel(channelA);
    chunk1.addChannel(channelB);
    chunk1.addMessage(messageA1);
    chunk1.addMessage(messageB2);

    const chunk2 = new ChunkBuilder({ useMessageIndex: true });
    chunk2.addChannel(channelB);
    chunk2.addMessage(messageB1);

    const builder = new McapRecordBuilder();
    builder.writeMagic();
    builder.writeHeader({ profile: "", library: "" });

    const chunkIndexes: TypedMcapRecords["ChunkIndex"][] = [];
    chunkIndexes.push(writeChunkWithMessageIndexes(builder, chunk1));
    chunkIndexes.push(writeChunkWithMessageIndexes(builder, chunk2));

    builder.writeDataEnd({ dataSectionCrc: 0 });

    const summaryStart = BigInt(builder.length);

    builder.writeChannel(channelA);
    builder.writeChannel(channelB);

    for (const index of chunkIndexes) {
      builder.writeChunkIndex(index);
    }

    builder.writeFooter({ summaryStart, summaryOffsetStart: 0n, summaryCrc: 0 });
    builder.writeMagic();

    {
      const readable = makeReadable(builder.buffer);
      const reader = await McapIndexedReader.Initialize({ readable });
      expect(readable.readCalls).toEqual(4);

      const messageIter = reader.readMessages({ topics: [channelB.topic] });
      expect(readable.readCalls).toEqual(4);

      const collected = [];

      collected.push((await messageIter.next()).value);
      expect(readable.readCalls).toEqual(7);
      collected.push((await messageIter.next()).value);
      expect(readable.readCalls).toEqual(8);

      expect(collected).toEqual([messageB1, messageB2]);
    }

    {
      const readable = makeReadable(builder.buffer);
      const reader = await McapIndexedReader.Initialize({ readable });
      expect(readable.readCalls).toEqual(4);

      const messageIter = reader.readMessages({ topics: [channelB.topic], reverse: true });
      expect(readable.readCalls).toEqual(4);

      const collected = [];

      collected.push((await messageIter.next()).value);
      expect(readable.readCalls).toEqual(6);
      collected.push((await messageIter.next()).value);
      expect(readable.readCalls).toEqual(8);

      expect(collected).toEqual([messageB1, messageB2].reverse());
    }
  });

  it("re-reads message indexes on every readMessages() call", async () => {
    const channel: TypedMcapRecord = {
      type: "Channel",
      id: 1,
      schemaId: 0,
      topic: "a",
      messageEncoding: "utf12",
      metadata: new Map(),
    };
    const message: TypedMcapRecords["Message"] = {
      type: "Message",
      channelId: channel.id,
      sequence: 1,
      logTime: 1n,
      publishTime: 0n,
      data: new Uint8Array(),
    };

    const chunk = new ChunkBuilder({ useMessageIndex: true });
    chunk.addChannel(channel);
    chunk.addMessage(message);

    const builder = new McapRecordBuilder();
    builder.writeMagic();
    builder.writeHeader({ profile: "", library: "" });
    const chunkIndexes: TypedMcapRecords["ChunkIndex"][] = [
      writeChunkWithMessageIndexes(builder, chunk),
    ];
    builder.writeDataEnd({ dataSectionCrc: 0 });

    const summaryStart = BigInt(builder.length);
    builder.writeChannel(channel);
    for (const index of chunkIndexes) {
      builder.writeChunkIndex(index);
    }
    builder.writeFooter({ summaryStart, summaryOffsetStart: 0n, summaryCrc: 0 });
    builder.writeMagic();

    const chunkIndex = chunkIndexes[0]!;
    let messageIndexStart: bigint | undefined;
    for (const offset of chunkIndex.messageIndexOffsets.values()) {
      if (messageIndexStart == undefined || offset < messageIndexStart) {
        messageIndexStart = offset;
      }
    }
    const messageIndexRange = {
      start: messageIndexStart!,
      end: messageIndexStart! + chunkIndex.messageIndexLength,
    };

    const reads: { offset: bigint; size: bigint }[] = [];
    const underlyingReadable = makeReadable(builder.buffer);
    const recordingReadable = {
      size: underlyingReadable.size.bind(underlyingReadable),
      read: async (offset: bigint, size: bigint) => {
        reads.push({ offset, size });
        return await underlyingReadable.read(offset, size);
      },
    };
    const overlapsMessageIndex = ({ offset, size }: { offset: bigint; size: bigint }) =>
      offset < messageIndexRange.end && offset + size > messageIndexRange.start;

    const reader = await McapIndexedReader.Initialize({ readable: recordingReadable });

    reads.length = 0;
    await collect(reader.readMessages());
    expect(reads.some(overlapsMessageIndex)).toBe(true);

    reads.length = 0;
    await collect(reader.readMessages());
    // Without caching, the message index is re-read on every call.
    expect(reads.some(overlapsMessageIndex)).toBe(true);
  });

  it("reads metadata records", async () => {
    const data = [
      ...MCAP_MAGIC,
      ...record(Opcode.HEADER, [
        ...string(""), // profile
        ...string(""), // library
      ]),
    ];
    const metadata1Start = data.length;
    data.push(
      ...record(Opcode.METADATA, [
        ...string("foo"), // name
        ...keyValues(string, string, [
          ["a", "1"],
          ["b", "2"],
        ]), // metadata
      ]),
    );
    const metadata2Start = data.length;
    data.push(
      ...record(Opcode.METADATA, [
        ...string("bar"), // name
        ...keyValues(string, string, [
          ["x", "10"],
          ["y", "20"],
        ]), // metadata
      ]),
    );
    const metadata3Start = data.length;
    data.push(
      ...record(Opcode.METADATA, [
        ...string("foo"), // name
        ...keyValues(string, string, [["b", "4"]]), // metadata
      ]),
    );
    const dataEndStart = data.length;
    data.push(
      ...record(Opcode.DATA_END, [
        ...uint32LE(0), // data crc
      ]),
    );
    const summaryStart = data.length;
    data.push(
      ...record(Opcode.METADATA_INDEX, [
        ...uint64LE(BigInt(metadata1Start)), // offset
        ...uint64LE(BigInt(metadata2Start - metadata1Start)), // length
        ...string("foo"), // name
      ]),
      ...record(Opcode.METADATA_INDEX, [
        ...uint64LE(BigInt(metadata2Start)), // offset
        ...uint64LE(BigInt(metadata3Start - metadata2Start)), // length
        ...string("bar"), // name
      ]),
      ...record(Opcode.METADATA_INDEX, [
        ...uint64LE(BigInt(metadata3Start)), // offset
        ...uint64LE(BigInt(dataEndStart - metadata3Start)), // length
        ...string("foo"), // name
      ]),
      ...record(Opcode.FOOTER, [
        ...uint64LE(BigInt(summaryStart)), // summary start
        ...uint64LE(0n), // summary offset start
        ...uint32LE(0), // summary crc
      ]),
      ...MCAP_MAGIC,
    );
    const readable = makeReadable(new Uint8Array(data));
    const reader = await McapIndexedReader.Initialize({ readable });

    expect(reader.metadataIndexes).toHaveLength(3);

    let metadata = await collect(reader.readMetadata());
    expect(metadata).toEqual([
      {
        name: "foo",
        metadata: new Map([
          ["a", "1"],
          ["b", "2"],
        ]),
        type: "Metadata",
      },
      {
        name: "bar",
        metadata: new Map([
          ["x", "10"],
          ["y", "20"],
        ]),
        type: "Metadata",
      },
      {
        name: "foo",
        metadata: new Map([["b", "4"]]),
        type: "Metadata",
      },
    ]);

    metadata = await collect(reader.readMetadata({ name: "bar" }));
    expect(metadata).toEqual([
      {
        name: "bar",
        metadata: new Map([
          ["x", "10"],
          ["y", "20"],
        ]),
        type: "Metadata",
      },
    ]);
  });

  it("reads attachment records", async () => {
    const data = [
      ...MCAP_MAGIC,
      ...record(Opcode.HEADER, [
        ...string(""), // profile
        ...string(""), // library
      ]),
    ];
    const attachment1Start = data.length;
    data.push(
      ...record(Opcode.ATTACHMENT, [
        ...uint64LE(1n), // log time
        ...uint64LE(2n), // create time
        ...string("foo"), // name
        ...string("text/plain"), // media type
        ...uint64LE(5n), // data length
        ...new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]), // data
        ...uint32LE(0), // data crc
      ]),
    );
    const attachment2Start = data.length;
    data.push(
      ...record(Opcode.ATTACHMENT, [
        ...uint64LE(4n), // log time
        ...uint64LE(5n), // create time
        ...string("bar"), // name
        ...string("application/octet-stream"), // media type
        ...uint64LE(3n), // data length
        ...new Uint8Array([1, 2, 3]), // data
        ...uint32LE(0), // data crc
      ]),
    );
    const attachment3Start = data.length;
    data.push(
      ...record(Opcode.ATTACHMENT, [
        ...uint64LE(6n), // log time
        ...uint64LE(7n), // create time
        ...string("foo"), // name
        ...string("application/json"), // media type
        ...uint64LE(2n), // data length
        ...new Uint8Array([0x7b, 0x7d]), // data
        ...uint32LE(0), // data crc
      ]),
    );
    const dataEndStart = data.length;
    data.push(
      ...record(Opcode.DATA_END, [
        ...uint32LE(0), // data crc
      ]),
    );
    const summaryStart = data.length;
    data.push(
      ...record(Opcode.ATTACHMENT_INDEX, [
        ...uint64LE(BigInt(attachment1Start)), // offset
        ...uint64LE(BigInt(attachment2Start - attachment1Start)), // length
        ...uint64LE(1n), // log time
        ...uint64LE(2n), // create time
        ...uint64LE(5n), // data size
        ...string("foo"), // name
        ...string("text/plain"), // media type
      ]),
      ...record(Opcode.ATTACHMENT_INDEX, [
        ...uint64LE(BigInt(attachment2Start)), // offset
        ...uint64LE(BigInt(attachment3Start - attachment2Start)), // length
        ...uint64LE(4n), // log time
        ...uint64LE(5n), // create time
        ...uint64LE(3n), // data size
        ...string("bar"), // name
        ...string("application/octet-stream"), // media type
      ]),
      ...record(Opcode.ATTACHMENT_INDEX, [
        ...uint64LE(BigInt(attachment3Start)), // offset
        ...uint64LE(BigInt(dataEndStart - attachment3Start)), // length
        ...uint64LE(6n), // log time
        ...uint64LE(7n), // create time
        ...uint64LE(2n), // data size
        ...string("foo"), // name
        ...string("application/json"), // media type
      ]),
      ...record(Opcode.FOOTER, [
        ...uint64LE(BigInt(summaryStart)), // summary start
        ...uint64LE(0n), // summary offset start
        ...uint32LE(0), // summary crc
      ]),
      ...MCAP_MAGIC,
    );
    const readable = makeReadable(new Uint8Array(data));
    const reader = await McapIndexedReader.Initialize({ readable });

    expect(reader.attachmentIndexes).toHaveLength(3);

    let attachments = await collect(reader.readAttachments());
    expect(attachments).toEqual([
      {
        name: "foo",
        logTime: 1n,
        createTime: 2n,
        mediaType: "text/plain",
        data: new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]),
        type: "Attachment",
      },
      {
        name: "bar",
        logTime: 4n,
        createTime: 5n,
        mediaType: "application/octet-stream",
        data: new Uint8Array([1, 2, 3]),
        type: "Attachment",
      },
      {
        name: "foo",
        logTime: 6n,
        createTime: 7n,
        mediaType: "application/json",
        data: new Uint8Array([0x7b, 0x7d]),
        type: "Attachment",
      },
    ]);

    attachments = await collect(reader.readAttachments({ name: "bar" }));
    expect(attachments).toEqual([
      {
        name: "bar",
        logTime: 4n,
        createTime: 5n,
        mediaType: "application/octet-stream",
        data: new Uint8Array([1, 2, 3]),
        type: "Attachment",
      },
    ]);

    attachments = await collect(reader.readAttachments({ mediaType: "application/json" }));
    expect(attachments).toEqual([
      {
        name: "foo",
        logTime: 6n,
        createTime: 7n,
        mediaType: "application/json",
        data: new Uint8Array([0x7b, 0x7d]),
        type: "Attachment",
      },
    ]);

    attachments = await collect(reader.readAttachments({ startingAt: 3n, endingAt: 5n }));
    expect(attachments).toEqual([
      {
        name: "bar",
        logTime: 4n,
        createTime: 5n,
        mediaType: "application/octet-stream",
        data: new Uint8Array([1, 2, 3]),
        type: "Attachment",
      },
    ]);

    // Attachments have log times 1, 4, and 6.
    attachments = await collect(reader.readAttachments({ startingAt: 4n, endingAt: 4n }));
    expect(attachments.map((attachment) => attachment.logTime)).toEqual([4n]);
    attachments = await collect(reader.readAttachments({ startingAt: 4n, endingBefore: 6n }));
    expect(attachments.map((attachment) => attachment.logTime)).toEqual([4n]);
    attachments = await collect(reader.readAttachments({ startingAfter: 4n, endingAt: 6n }));
    expect(attachments.map((attachment) => attachment.logTime)).toEqual([6n]);
    await expect(
      collect(reader.readAttachments({ endingAt: 4n, endingBefore: 4n })),
    ).rejects.toThrow("at most one of endingAt, endingBefore");
  });

  it("supports chunk index where message index is empty", async () => {
    const channel1: TypedMcapRecord = {
      type: "Channel",
      id: 1,
      schemaId: 0,
      topic: "a",
      messageEncoding: "utf12",
      metadata: new Map(),
    };
    const makeMessage = (idx: number): TypedMcapRecords["Message"] => {
      return {
        type: "Message",
        channelId: channel1.id,
        sequence: idx,
        logTime: BigInt(idx),
        publishTime: 0n,
        data: new Uint8Array(),
      };
    };
    const message1 = makeMessage(1);
    const message2 = makeMessage(2);

    const chunk1 = new ChunkBuilder({ useMessageIndex: true });
    chunk1.addChannel(channel1);
    chunk1.addMessage(message1);

    const emptyChunk = new ChunkBuilder({ useMessageIndex: true });

    const chunk2 = new ChunkBuilder({ useMessageIndex: true });
    chunk2.addChannel(channel1);
    chunk2.addMessage(message2);

    const builder = new McapRecordBuilder();
    builder.writeMagic();
    builder.writeHeader({ profile: "", library: "" });

    const chunkIndexes: TypedMcapRecords["ChunkIndex"][] = [];
    chunkIndexes.push(writeChunkWithMessageIndexes(builder, chunk1));
    chunkIndexes.push(writeChunkWithMessageIndexes(builder, emptyChunk));
    chunkIndexes.push(writeChunkWithMessageIndexes(builder, chunk2));

    builder.writeDataEnd({ dataSectionCrc: 0 });

    const summaryStart = BigInt(builder.length);

    for (const index of chunkIndexes) {
      builder.writeChunkIndex(index);
    }

    builder.writeFooter({ summaryStart, summaryOffsetStart: 0n, summaryCrc: 0 });
    builder.writeMagic();

    const reader = await McapIndexedReader.Initialize({ readable: makeReadable(builder.buffer) });
    await expect(collect(reader.readMessages())).resolves.toEqual([message1, message2]);
  });

  it("passes readOptions to readable.read()", async () => {
    const channel: TypedMcapRecord = {
      type: "Channel",
      id: 1,
      schemaId: 0,
      topic: "a",
      messageEncoding: "utf12",
      metadata: new Map(),
    };
    const message: TypedMcapRecords["Message"] = {
      type: "Message",
      channelId: channel.id,
      sequence: 1,
      logTime: 1n,
      publishTime: 0n,
      data: new Uint8Array(),
    };

    const chunk = new ChunkBuilder({ useMessageIndex: true });
    chunk.addChannel(channel);
    chunk.addMessage(message);

    const metadata = {
      name: "meta",
      metadata: new Map([["k", "v"]]),
    };
    const attachment = {
      name: "file",
      logTime: 1n,
      createTime: 2n,
      mediaType: "text/plain",
      data: new Uint8Array([1, 2, 3]),
    };

    const builder = new McapRecordBuilder();
    builder.writeMagic();
    builder.writeHeader({ profile: "", library: "" });
    const chunkIndexes: TypedMcapRecords["ChunkIndex"][] = [
      writeChunkWithMessageIndexes(builder, chunk),
    ];
    const metadataOffset = BigInt(builder.length);
    const metadataLength = builder.writeMetadata(metadata);
    const attachmentOffset = BigInt(builder.length);
    const attachmentLength = builder.writeAttachment(attachment);
    builder.writeDataEnd({ dataSectionCrc: 0 });

    const summaryStart = BigInt(builder.length);
    builder.writeChannel(channel);
    for (const index of chunkIndexes) {
      builder.writeChunkIndex(index);
    }
    builder.writeMetadataIndex({
      offset: metadataOffset,
      length: metadataLength,
      name: metadata.name,
    });
    builder.writeAttachmentIndex({
      offset: attachmentOffset,
      length: attachmentLength,
      logTime: attachment.logTime,
      createTime: attachment.createTime,
      dataSize: BigInt(attachment.data.byteLength),
      name: attachment.name,
      mediaType: attachment.mediaType,
    });
    builder.writeFooter({ summaryStart, summaryOffsetStart: 0n, summaryCrc: 0 });
    builder.writeMagic();

    const receivedOptions: unknown[] = [];
    const underlyingReadable = makeReadable(builder.buffer);
    const recordingReadable = {
      size: underlyingReadable.size.bind(underlyingReadable),
      read: async (offset: bigint, size: bigint, options?: unknown) => {
        receivedOptions.push(options);
        return await underlyingReadable.read(offset, size);
      },
    };

    const initializeOptions = { label: "init" };
    const reader = await McapIndexedReader.Initialize({
      readable: recordingReadable,
      readOptions: initializeOptions,
    });
    expect(receivedOptions.length).toBeGreaterThan(0);
    expect(receivedOptions.every((options) => options === initializeOptions)).toBe(true);

    receivedOptions.length = 0;
    const readMessagesOptions = { label: "messages" };
    await expect(
      collect(reader.readMessages({ readOptions: readMessagesOptions })),
    ).resolves.toEqual([message]);
    expect(receivedOptions.length).toBeGreaterThan(0);
    expect(receivedOptions.every((options) => options === readMessagesOptions)).toBe(true);

    receivedOptions.length = 0;
    const readMetadataOptions = { label: "metadata" };
    await expect(
      collect(reader.readMetadata({ readOptions: readMetadataOptions })),
    ).resolves.toEqual([{ ...metadata, type: "Metadata" }]);
    expect(receivedOptions.length).toBeGreaterThan(0);
    expect(receivedOptions.every((options) => options === readMetadataOptions)).toBe(true);

    receivedOptions.length = 0;
    const readAttachmentsOptions = { label: "attachments" };
    await expect(
      collect(reader.readAttachments({ readOptions: readAttachmentsOptions })),
    ).resolves.toEqual([{ ...attachment, type: "Attachment" }]);
    expect(receivedOptions.length).toBeGreaterThan(0);
    expect(receivedOptions.every((options) => options === readAttachmentsOptions)).toBe(true);
  });

  it("reads chunks appended to the index, also without time bounds", async () => {
    const buffer = new TempBuffer();
    // A tiny chunk size puts each message in its own chunk
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
    const reader = await McapIndexedReader.Initialize({ readable: makeReadable(buffer.get()) });
    const chunks = [...reader.chunkIndexes];
    expect(chunks).toHaveLength(3);
    const logTimes = async () =>
      (await collect(reader.readMessages())).map((message) => message.logTime);

    reader.setChunkIndexes(chunks.slice(0, 1));
    await expect(logTimes()).resolves.toEqual([0n]);

    reader.appendIndex({ chunkIndexes: chunks.slice(1) });
    expect(reader.chunkIndexes).toEqual(chunks);
    await expect(logTimes()).resolves.toEqual([0n, 1n, 2n]);

    // Appending the reader's own index adds each entry once
    reader.appendIndex({ chunkIndexes: reader.chunkIndexes });
    expect(reader.chunkIndexes).toHaveLength(6);
  });

  it("finds the chunks in a time range, also overlapping and out of file order", async () => {
    const buffer = new TempBuffer();
    const writer = new McapWriter({ writable: buffer });
    await writer.start({ profile: "", library: "" });
    await writer.end();
    const reader = await McapIndexedReader.Initialize({ readable: makeReadable(buffer.get()) });
    const chunk = (start: number, end: number, offset: number) =>
      ({
        messageStartTime: BigInt(start),
        messageEndTime: BigInt(end),
        chunkStartOffset: BigInt(offset),
      }) as TypedMcapRecords["ChunkIndex"];
    // A long chunk spanning later short ones, and one written out of time order
    const long = chunk(0, 100, 1);
    const a = chunk(10, 19, 2);
    const c = chunk(30, 39, 3);
    const b = chunk(20, 29, 4);
    reader.setChunkIndexes([long, a, c, b]);
    const offsets = (start: number, end: number) =>
      reader.chunksInTimeRange(BigInt(start), BigInt(end)).map((x) => x.chunkStartOffset);

    expect(offsets(0, 200)).toEqual([1n, 2n, 4n, 3n]);
    expect(offsets(25, 25)).toEqual([1n, 4n]);
    expect(offsets(19, 20)).toEqual([1n, 2n, 4n]);
    expect(offsets(101, 200)).toEqual([]);

    // The lookup follows changes to the index
    reader.appendIndex({ chunkIndexes: [chunk(150, 160, 5)] });
    expect(offsets(101, 200)).toEqual([5n]);
    reader.setChunkIndexes([a]);
    expect(offsets(0, 200)).toEqual([2n]);
  });
});
