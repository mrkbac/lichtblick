// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ChunkCursor } from "./ChunkCursor.ts";
import McapByteReader from "./McapByteReader.ts";
import { McapIndexedReader } from "./McapIndexedReader.ts";
import { McapRecordBuilder } from "./McapRecordBuilder.ts";
import { McapWriter } from "./McapWriter.ts";
import { TempBuffer } from "./TempBuffer.ts";
import { Opcode } from "./constants.ts";
import { parseRecord } from "./parse.ts";
import { collect, record, uint32LE } from "./testUtils.ts";

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

describe("ChunkCursor", () => {
  it.each([false, true])(
    "rejects message index times outside the chunk bounds (reverse: %s)",
    async (reverse) => {
      const builder = new McapRecordBuilder();
      builder.writeMessageIndex({
        channelId: 1,
        records: [
          [5n, 0n],
          [25n, 10n],
        ],
      });
      const indexes = builder.buffer;
      const cursor = new ChunkCursor({
        chunkIndex: {
          messageStartTime: 10n,
          messageEndTime: 20n,
          chunkStartOffset: 0n,
          chunkLength: 0n,
          messageIndexOffsets: new Map([[1, 0n]]),
          messageIndexLength: BigInt(indexes.byteLength),
          compression: "",
          compressedSize: 0n,
          uncompressedSize: 0n,
        },
        relevantChannels: undefined,
        startingAt: undefined,
        endingAt: undefined,
        reverse,
      });
      const readable = {
        size: async () => BigInt(indexes.byteLength),
        read: async (offset: bigint, size: bigint) =>
          indexes.subarray(Number(offset), Number(offset + size)),
      };
      await expect(cursor.loadMessageIndexes(readable, async () => view(indexes))).rejects.toThrow(
        "earlier than chunk messageStartTime",
      );
    },
  );
});

describe("McapIndexedReader chunkCache and CRCs", () => {
  async function oneChunkFile(): Promise<TempBuffer> {
    const buffer = new TempBuffer();
    const writer = new McapWriter({ writable: buffer });
    await writer.start({ profile: "", library: "" });
    const channelId = await writer.registerChannel({
      topic: "/a",
      schemaId: 0,
      messageEncoding: "json",
      metadata: new Map(),
    });
    await writer.addMessage({
      channelId,
      sequence: 0,
      logTime: 1n,
      publishTime: 1n,
      data: new Uint8Array([1]),
    });
    await writer.end();
    return buffer;
  }

  it("rejects a corrupt chunk cached by a read that skipped CRCs", async () => {
    const buffer = await oneChunkFile();
    const cache = new Map<bigint, DataView>();
    const reader = await McapIndexedReader.Initialize({ readable: buffer, chunkCache: cache });
    // Corrupt the chunk's uncompressed CRC (opcode, length, start/end time, uncompressed size)
    const crcOffset = Number(reader.chunkIndexes[0]!.chunkStartOffset) + 1 + 8 + 8 + 8 + 8;
    buffer.get()[crcOffset]! ^= 0xff;

    await expect(collect(reader.readMessages({ validateCrcs: false }))).resolves.toHaveLength(1);
    expect(cache.size).toBe(1);
    await expect(collect(reader.readMessages())).rejects.toThrow("Incorrect chunk CRC");
  });

  it("reuses a cached chunk once a validating read has checked it", async () => {
    const buffer = await oneChunkFile();
    const cache = new Map<bigint, DataView>();
    const reader = await McapIndexedReader.Initialize({ readable: buffer, chunkCache: cache });
    await collect(reader.readMessages({ validateCrcs: false }));
    const unchecked = [...cache.values()][0];
    expect(unchecked).toBeDefined();
    // Served from the cache without a check
    await collect(reader.readMessages({ validateCrcs: false }));
    expect([...cache.values()][0]).toBe(unchecked);
    // A validating read loads and checks the chunk again, then caches the checked copy
    await collect(reader.readMessages());
    const checked = [...cache.values()][0];
    expect(checked).not.toBe(unchecked);
    await collect(reader.readMessages());
    expect([...cache.values()][0]).toBe(checked);
  });
});

describe("McapWriter", () => {
  it("rejects channel ids beyond 16 bits", async () => {
    const writer = new McapWriter({ writable: new TempBuffer(), startChannelId: 0xffff });
    const channel = { topic: "/a", schemaId: 0, messageEncoding: "json", metadata: new Map() };
    await expect(writer.registerChannel(channel)).resolves.toBe(0xffff);
    await expect(writer.registerChannel(channel)).rejects.toThrow("16-bit");
  });

  it("rejects a start channel id outside 16 bits", () => {
    for (const startChannelId of [-1, 0x10000, 1.5]) {
      expect(() => new McapWriter({ writable: new TempBuffer(), startChannelId })).toThrow(
        "not a 16-bit channel id",
      );
    }
  });

  it("does not count a rejected message in the statistics", async () => {
    const writer = new McapWriter({ writable: new TempBuffer() });
    await writer.start({ profile: "", library: "" });
    const message = { channelId: 0, sequence: 0, publishTime: 0n, data: new Uint8Array() };
    await expect(writer.addMessage({ ...message, logTime: 0n })).rejects.toThrow("missing channel");
    await writer.registerChannel({
      topic: "/a",
      schemaId: 0,
      messageEncoding: "json",
      metadata: new Map(),
    });
    await writer.addMessage({ ...message, logTime: 10n });
    expect(writer.statistics?.messageCount).toBe(1n);
    expect(writer.statistics?.messageStartTime).toBe(10n);
  });
});

describe("McapRecordBuilder", () => {
  it("returns the full record length for fixed-size records", () => {
    const builder = new McapRecordBuilder();
    expect(builder.writeFooter({ summaryStart: 0n, summaryOffsetStart: 0n, summaryCrc: 0 })).toBe(
      BigInt(builder.length),
    );
    const before = builder.length;
    expect(builder.writeDataEnd({ dataSectionCrc: 0 })).toBe(BigInt(builder.length - before));
  });
});

describe("parseRecord", () => {
  it("rejects a record whose fields read past its length", () => {
    // DataEnd claims 0 content bytes but its CRC field is 4 bytes; an unknown record follows.
    const bytes = new Uint8Array([
      ...record(Opcode.DATA_END, []),
      ...record(0x80 as Opcode, [...uint32LE(0)]),
    ]);
    expect(() => parseRecord(new McapByteReader(view(bytes)), true)).toThrow(
      "reads 4 bytes past its length 0",
    );
  });

  it("copies unknown record payloads", () => {
    const bytes = new Uint8Array(record(0x80 as Opcode, [1, 2, 3]));
    const parsed = parseRecord(new McapByteReader(view(bytes)), true);
    bytes.fill(0);
    expect(parsed).toEqual({ type: "Unknown", opcode: 0x80, data: new Uint8Array([1, 2, 3]) });
  });
});
