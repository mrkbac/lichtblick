// SPDX-FileCopyrightText: Copyright (c) Foxglove Technologies Inc
// SPDX-License-Identifier: MIT

import { crc32 } from "@foxglove/crc";

import McapByteReader from "./McapByteReader.ts";
import { McapIndexedReader } from "./McapIndexedReader.ts";
import McapStreamReader from "./McapStreamReader.ts";
import { McapWriter } from "./McapWriter.ts";
import { TempBuffer } from "./TempBuffer.ts";
import { Opcode } from "./constants.ts";
import { parseMagic, parseRecord } from "./parse.ts";
import { collect, keyValues, record, string, uint16LE, uint32LE, uint64LE } from "./testUtils.ts";
import type { TypedMcapRecord } from "./types.ts";
import { LIBRARY_IDENTIFIER, VERSION } from "./version.ts";

function readAsMcapStream(data: Uint8Array) {
  const reader = new McapStreamReader();
  reader.append(data);
  const records: TypedMcapRecord[] = [];
  for (let rec; (rec = reader.nextRecord()); ) {
    records.push(rec);
  }
  expect(reader.done()).toBe(true);
  return records;
}

describe("McapWriter", () => {
  it("uses the TypeScript library identifier by default", async () => {
    const tempBuffer = new TempBuffer();
    const writer = new McapWriter({ writable: tempBuffer });

    await writer.start();
    await writer.end();

    const records = readAsMcapStream(tempBuffer.get());
    expect(records[0]).toEqual({
      type: "Header",
      profile: "",
      library: LIBRARY_IDENTIFIER,
    });
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(LIBRARY_IDENTIFIER).toBe(`mcap-typescript/${VERSION}`);
    expect(LIBRARY_IDENTIFIER).toMatch(/^mcap-typescript\/.+/);
  });

  it("supports messages with logTime 0", async () => {
    const tempBuffer = new TempBuffer();
    const writer = new McapWriter({ writable: tempBuffer });

    await writer.start({ library: "", profile: "" });
    const channelId = await writer.registerChannel({
      topic: "test",
      schemaId: 0,
      messageEncoding: "json",
      metadata: new Map(),
    });
    await writer.addMessage({
      channelId,
      data: new Uint8Array(),
      sequence: 0,
      logTime: 0n,
      publishTime: 0n,
    });
    await writer.addMessage({
      channelId,
      data: new Uint8Array(),
      sequence: 1,
      logTime: 1n,
      publishTime: 1n,
    });
    await writer.end();

    const reader = await McapIndexedReader.Initialize({ readable: tempBuffer });

    expect(reader.chunkIndexes).toMatchObject([{ messageStartTime: 0n, messageEndTime: 1n }]);

    await expect(collect(reader.readMessages())).resolves.toEqual([
      {
        type: "Message",
        channelId,
        data: new Uint8Array(),
        sequence: 0,
        logTime: 0n,
        publishTime: 0n,
      },
      {
        type: "Message",
        channelId,
        data: new Uint8Array(),
        sequence: 1,
        logTime: 1n,
        publishTime: 1n,
      },
    ]);
    await expect(collect(reader.readMessages({ endingAt: 0n }))).resolves.toEqual([
      {
        type: "Message",
        channelId,
        data: new Uint8Array(),
        sequence: 0,
        logTime: 0n,
        publishTime: 0n,
      },
    ]);
    await expect(collect(reader.readMessages({ startingAt: 1n }))).resolves.toEqual([
      {
        type: "Message",
        channelId,
        data: new Uint8Array(),
        sequence: 1,
        logTime: 1n,
        publishTime: 1n,
      },
    ]);
  });

  it("supports multiple chunks", async () => {
    const tempBuffer = new TempBuffer();
    const writer = new McapWriter({ writable: tempBuffer, chunkSize: 0 });

    await writer.start({ library: "", profile: "" });
    const channelId = await writer.registerChannel({
      topic: "test",
      schemaId: 0,
      messageEncoding: "json",
      metadata: new Map(),
    });
    await writer.addMessage({
      channelId,
      data: new Uint8Array(),
      sequence: 0,
      logTime: 0n,
      publishTime: 0n,
    });
    await writer.addMessage({
      channelId,
      data: new Uint8Array(),
      sequence: 1,
      logTime: 1n,
      publishTime: 1n,
    });
    await writer.end();

    const reader = new McapStreamReader();
    reader.append(tempBuffer.get());
    const records: TypedMcapRecord[] = [];
    for (let rec; (rec = reader.nextRecord()); ) {
      records.push(rec);
    }

    expect(records).toEqual<TypedMcapRecord[]>([
      {
        type: "Header",
        library: "",
        profile: "",
      },
      {
        type: "Channel",
        id: 0,
        messageEncoding: "json",
        metadata: new Map(),
        schemaId: 0,
        topic: "test",
      },
      {
        type: "Message",
        channelId: 0,
        data: new Uint8Array(),
        logTime: 0n,
        publishTime: 0n,
        sequence: 0,
      },
      {
        type: "MessageIndex",
        channelId: 0,
        records: [[0n, 33n]],
      },
      {
        type: "Message",
        channelId: 0,
        data: new Uint8Array(),
        logTime: 1n,
        publishTime: 1n,
        sequence: 1,
      },
      {
        type: "MessageIndex",
        channelId: 0,
        records: [[1n, 0n]],
      },
      {
        type: "DataEnd",
        dataSectionCrc: 4132032003,
      },
      {
        type: "Channel",
        id: 0,
        messageEncoding: "json",
        metadata: new Map(),
        schemaId: 0,
        topic: "test",
      },
      {
        type: "Statistics",
        attachmentCount: 0,
        channelCount: 1,
        channelMessageCounts: new Map([[0, 2n]]),
        chunkCount: 2,
        messageCount: 2n,
        messageEndTime: 1n,
        messageStartTime: 0n,
        metadataCount: 0,
        schemaCount: 0,
      },
      {
        type: "ChunkIndex",
        chunkLength: 113n,
        chunkStartOffset: 25n,
        compressedSize: 64n,
        compression: "",
        messageEndTime: 0n,
        messageIndexLength: 31n,
        messageIndexOffsets: new Map([[0, 138n]]),
        messageStartTime: 0n,
        uncompressedSize: 64n,
      },
      {
        type: "ChunkIndex",
        chunkLength: 80n,
        chunkStartOffset: 169n,
        compressedSize: 31n,
        compression: "",
        messageEndTime: 1n,
        messageIndexLength: 31n,
        messageIndexOffsets: new Map([[0, 249n]]),
        messageStartTime: 1n,
        uncompressedSize: 31n,
      },
      {
        type: "SummaryOffset",
        groupLength: 33n,
        groupOpcode: Opcode.CHANNEL,
        groupStart: 293n,
      },
      {
        type: "SummaryOffset",
        groupLength: 65n,
        groupOpcode: Opcode.STATISTICS,
        groupStart: 326n,
      },
      {
        type: "SummaryOffset",
        groupLength: 166n,
        groupOpcode: Opcode.CHUNK_INDEX,
        groupStart: 391n,
      },
      {
        type: "Footer",
        summaryCrc: 3779440972,
        summaryOffsetStart: 557n,
        summaryStart: 293n,
      },
    ]);
  });

  it("supports chunk compression", async () => {
    function reverse(data: Uint8Array): Uint8Array {
      return Uint8Array.from(data, (_, i) => data[data.byteLength - 1 - i]!);
    }
    function reverseDouble(data: Uint8Array): Uint8Array {
      return new Uint8Array([...reverse(data), ...reverse(data)]);
    }

    const tempBuffer = new TempBuffer();
    const writer = new McapWriter({
      writable: tempBuffer,
      useStatistics: false,
      useSummaryOffsets: false,
      compressChunk: (data) => ({
        compression: "reverse double",
        compressedData: reverseDouble(data),
      }),
    });

    await writer.start({ library: "", profile: "" });
    const channelId = await writer.registerChannel({
      topic: "test",
      schemaId: 0,
      messageEncoding: "json",
      metadata: new Map(),
    });
    await writer.addMessage({
      channelId,
      data: new Uint8Array(),
      sequence: 0,
      logTime: 0n,
      publishTime: 0n,
    });
    await writer.end();

    const array = tempBuffer.get();
    const view = new DataView(array.buffer, array.byteOffset, array.byteLength);
    const reader = new McapByteReader(view);
    const records: TypedMcapRecord[] = [];
    parseMagic(reader);
    let result;
    while ((result = parseRecord(reader, true))) {
      records.push(result);
    }

    const expectedChunkData = new Uint8Array([
      ...record(Opcode.CHANNEL, [
        ...uint16LE(channelId), // channel id
        ...uint16LE(0), // schema id
        ...string("test"), // topic
        ...string("json"), // message encoding
        ...keyValues(string, string, []), // metadata
      ]),
      ...record(Opcode.MESSAGE, [
        ...uint16LE(channelId), // channel id
        ...uint32LE(0), // sequence
        ...uint64LE(0n), // log time
        ...uint64LE(0n), // publish time
      ]),
    ]);

    expect(records).toEqual<TypedMcapRecord[]>([
      {
        type: "Header",
        library: "",
        profile: "",
      },
      {
        type: "Chunk",
        compression: "reverse double",
        messageStartTime: 0n,
        messageEndTime: 0n,
        uncompressedCrc: crc32(expectedChunkData),
        uncompressedSize: BigInt(expectedChunkData.byteLength),
        records: reverseDouble(expectedChunkData),
      },
      {
        type: "MessageIndex",
        channelId: 0,
        records: [[0n, 33n]],
      },
      {
        type: "DataEnd",
        dataSectionCrc: 475180730,
      },
      {
        type: "Channel",
        id: 0,
        messageEncoding: "json",
        metadata: new Map(),
        schemaId: 0,
        topic: "test",
      },
      {
        type: "ChunkIndex",
        chunkLength: expect.any(BigInt) as bigint,
        chunkStartOffset: 25n,
        compressedSize: BigInt(2 * expectedChunkData.byteLength),
        compression: "reverse double",
        messageEndTime: 0n,
        messageIndexLength: 31n,
        messageIndexOffsets: new Map([[0, expect.any(BigInt) as bigint]]),
        messageStartTime: 0n,
        uncompressedSize: BigInt(expectedChunkData.byteLength),
      },
      {
        type: "Footer",
        summaryCrc: expect.any(Number) as number,
        summaryOffsetStart: expect.any(BigInt) as bigint,
        summaryStart: expect.any(BigInt) as bigint,
      },
    ]);
  });

  it("gives compressChunk an exact-size copy the callback may keep", async () => {
    const inputs: Uint8Array[] = [];
    const snapshots: Uint8Array[] = [];
    const writer = new McapWriter({
      writable: new TempBuffer(),
      chunkSize: 1, // every message closes a chunk
      compressChunk: (data) => {
        inputs.push(data);
        snapshots.push(data.slice());
        return { compression: "", compressedData: data };
      },
    });
    await writer.start();
    const channelId = await writer.registerChannel({
      topic: "test",
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
        data: new Uint8Array(64).fill(i + 1),
      });
    }
    await writer.end();

    expect(inputs).toHaveLength(3);
    for (const [i, input] of inputs.entries()) {
      // a private, exact-size backing buffer: safe to transfer or read via .buffer
      expect(input.byteOffset).toBe(0);
      expect(input.buffer.byteLength).toBe(input.byteLength);
      // not overwritten by the chunks finalized after it
      expect(input).toEqual(snapshots[i]);
    }
  });

  it("indexes attachments and metadata added after messages without chunks", async () => {
    const tempBuffer = new TempBuffer();
    const writer = new McapWriter({ writable: tempBuffer, useChunks: false });
    await writer.start();
    const channelId = await writer.registerChannel({
      topic: "test",
      schemaId: 0,
      messageEncoding: "json",
      metadata: new Map(),
    });
    await writer.addMessage({
      channelId,
      sequence: 0,
      logTime: 0n,
      publishTime: 0n,
      data: new Uint8Array(),
    });
    await writer.addAttachment({
      name: "attachment",
      logTime: 0n,
      createTime: 0n,
      mediaType: "text/plain",
      data: new TextEncoder().encode("foo"),
    });
    await writer.addMessage({
      channelId,
      sequence: 1,
      logTime: 1n,
      publishTime: 1n,
      data: new Uint8Array(),
    });
    await writer.addMetadata({ name: "metadata", metadata: new Map([["key", "value"]]) });
    await writer.end();

    const reader = await McapIndexedReader.Initialize({ readable: tempBuffer });
    expect((await collect(reader.readAttachments())).map((a) => a.name)).toEqual(["attachment"]);
    expect((await collect(reader.readMetadata())).map((m) => m.name)).toEqual(["metadata"]);
  });

  it("flushes unchunked records as they accumulate and keeps indexes and data section CRC correct", async () => {
    const tempBuffer = new TempBuffer();
    const writeSpy = vi.spyOn(tempBuffer, "write");
    const writer = new McapWriter({ writable: tempBuffer, useChunks: false });
    await writer.start();
    const channelId = await writer.registerChannel({
      topic: "test",
      schemaId: 0,
      messageEncoding: "json",
      metadata: new Map(),
    });
    // Each message alone exceeds the 1 MiB write buffer, so every message is written out as it
    // is added, exercising the mid-stream write path.
    const writesBeforeMessages = writeSpy.mock.calls.length;
    for (let i = 0; i < 3; i++) {
      await writer.addMessage({
        channelId,
        sequence: i,
        logTime: BigInt(i),
        publishTime: BigInt(i),
        data: new Uint8Array(1024 * 1024).fill(i),
      });
    }
    expect(writeSpy.mock.calls.length - writesBeforeMessages).toBe(3);
    // A small message stays buffered rather than being written out immediately
    await writer.addMessage({
      channelId,
      sequence: 3,
      logTime: 3n,
      publishTime: 3n,
      data: new Uint8Array([3]),
    });
    expect(writeSpy.mock.calls.length - writesBeforeMessages).toBe(3);
    await writer.addAttachment({
      name: "attachment",
      logTime: 0n,
      createTime: 0n,
      mediaType: "text/plain",
      data: new TextEncoder().encode("foo"),
    });
    await writer.addMetadata({ name: "metadata", metadata: new Map([["key", "value"]]) });
    await writer.end();

    const reader = await McapIndexedReader.Initialize({ readable: tempBuffer });
    expect(reader.dataSectionCrc).toEqual(
      crc32(tempBuffer.get().slice(0, Number(reader.dataEndOffset))),
    );
    expect((await collect(reader.readAttachments())).map((a) => a.name)).toEqual(["attachment"]);
    expect((await collect(reader.readMetadata())).map((m) => m.name)).toEqual(["metadata"]);
    // unchunked messages are only visible to a streaming read
    const messages = readAsMcapStream(tempBuffer.get()).filter((rec) => rec.type === "Message");
    expect(messages.map((rec) => rec.data.byteLength)).toEqual([
      1024 * 1024,
      1024 * 1024,
      1024 * 1024,
      1,
    ]);
    // (avoid toEqual on the full arrays, which is very slow for 1 MiB typed arrays)
    messages.forEach((rec, i) => {
      expect(rec.data.every((byte) => byte === i)).toBe(true);
    });
  });

  it("keeps the summary consistent when it omits channels or summary offsets", async () => {
    async function summary(options: { repeatChannels?: boolean; useStatistics?: boolean }) {
      const buffer = new TempBuffer();
      const writer = new McapWriter({ writable: buffer, repeatSchemas: false, ...options });
      await writer.start({ library: "", profile: "" });
      if (options.useStatistics !== false) {
        const channelId = await writer.registerChannel({
          topic: "/a",
          schemaId: 0,
          messageEncoding: "json",
          metadata: new Map(),
        });
        await writer.addMessage({
          channelId,
          data: new Uint8Array(),
          sequence: 0,
          logTime: 0n,
          publishTime: 0n,
        });
      }
      await writer.end();
      return readAsMcapStream(buffer.get());
    }

    // Per-channel counts would refer to Channel records the summary doesn't have
    const noChannels = await summary({ repeatChannels: false });
    const statistics = noChannels.find((rec) => rec.type === "Statistics");
    expect(statistics).toMatchObject({ messageCount: 1n, channelMessageCounts: new Map() });

    // No summary group is written, so no Summary Offset record either
    const empty = await summary({ useStatistics: false, repeatChannels: false });
    expect(empty.some((rec) => rec.type === "SummaryOffset")).toBe(false);
    expect(empty.find((rec) => rec.type === "Footer")).toMatchObject({ summaryOffsetStart: 0n });
  });
});
