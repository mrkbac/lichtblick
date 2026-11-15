// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ChunkCache } from "./ChunkCache.ts";
import type { ChunkReadAhead } from "./McapIndexedReader.ts";
import { McapIndexedReader } from "./McapIndexedReader.ts";
import { McapWriter } from "./McapWriter.ts";
import { TempBuffer } from "./TempBuffer.ts";
import type { DecompressHandlers } from "./types.ts";

// A stand-in compression: the bytes reversed
const reverse = (data: Uint8Array) => data.slice().reverse();

/** One message per chunk, alternating between /a and /b, with log times 0..count-1 */
async function writeFile(count: number): Promise<TempBuffer> {
  const buffer = new TempBuffer();
  const writer = new McapWriter({
    writable: buffer,
    chunkSize: 1,
    compressChunk: (data) => ({ compression: "rev", compressedData: reverse(data) }),
  });
  await writer.start({ profile: "", library: "" });
  const channels = [];
  for (const topic of ["/a", "/b"]) {
    channels.push(
      await writer.registerChannel({
        topic,
        schemaId: 0,
        messageEncoding: "json",
        metadata: new Map(),
      }),
    );
  }
  for (let i = 0; i < count; i++) {
    await writer.addMessage({
      channelId: channels[i % 2]!,
      sequence: i,
      logTime: BigInt(i),
      publishTime: BigInt(i),
      data: new Uint8Array([i]),
    });
  }
  await writer.end();
  return buffer;
}

function fakeReadAhead(capacityBytes = Infinity) {
  let used = 0;
  const decompressed: number[] = []; // sizes, in call order
  const readAhead: ChunkReadAhead & { used: () => number; decompressed: number[] } = {
    chunks: 2,
    reserve: (bytes) => {
      if (used + bytes > capacityBytes) {
        return false;
      }
      used += bytes;
      return true;
    },
    release: (bytes) => {
      used -= bytes;
    },
    decompress: async (_compression, data) => {
      decompressed.push(data.byteLength);
      return reverse(data);
    },
    used: () => used,
    decompressed,
  };
  return readAhead;
}

async function open(buffer: TempBuffer, readAhead: ChunkReadAhead | undefined) {
  let inline = 0;
  const decompressHandlers: DecompressHandlers = {
    rev: (data) => {
      inline++;
      return reverse(data);
    },
  };
  const reader = await McapIndexedReader.Initialize({
    readable: buffer,
    decompressHandlers,
    chunkCache: new ChunkCache(readAhead),
  });
  return { reader, inline: () => inline };
}

async function collect(
  reader: McapIndexedReader,
  args: Parameters<McapIndexedReader["readMessages"]>[0] = {},
): Promise<number[]> {
  const data: number[] = [];
  for await (const message of reader.readMessages({ validateCrcs: false, ...args })) {
    data.push(message.data[0]!);
  }
  return data;
}

describe("McapIndexedReader read-ahead", () => {
  it("decompresses every chunk but the first through read-ahead, with the same messages", async () => {
    // Given a file of 10 single-message chunks, opened with read-ahead
    const buffer = await writeFile(10);
    const readAhead = fakeReadAhead();
    const { reader, inline } = await open(buffer, readAhead);

    // When all of it is read, Then the messages are the same
    await expect(collect(reader)).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // And only the first chunk was decompressed inline, with every reserved byte given back
    expect(inline()).toBe(1);
    expect(readAhead.decompressed).toHaveLength(9);
    expect(readAhead.used()).toBe(0);
  });

  it("reads ahead in reverse for a reverse read", async () => {
    // Given a file opened with read-ahead
    const buffer = await writeFile(6);
    const readAhead = fakeReadAhead();
    const { reader, inline } = await open(buffer, readAhead);

    // When it is read backwards, Then only its last chunk is decompressed inline
    await expect(collect(reader, { reverse: true })).resolves.toEqual([5, 4, 3, 2, 1, 0]);
    expect(inline()).toBe(1);
  });

  it("only reads ahead chunks with a message on a requested topic", async () => {
    // Given a file whose chunks alternate between two topics, opened with read-ahead
    const buffer = await writeFile(10);
    const readAhead = fakeReadAhead();
    const { reader, inline } = await open(buffer, readAhead);

    // When one topic is read, Then only its five chunks are decompressed
    await expect(collect(reader, { topics: ["/b"] })).resolves.toEqual([1, 3, 5, 7, 9]);
    expect(inline() + readAhead.decompressed.length).toBe(5);
  });

  it("decompresses inline what doesn't fit in the read-ahead cap", async () => {
    // Given read-ahead with no room
    const buffer = await writeFile(6);
    const readAhead = fakeReadAhead(0);
    const { reader, inline } = await open(buffer, readAhead);

    // When the file is read, Then every chunk is decompressed inline
    await expect(collect(reader)).resolves.toEqual([0, 1, 2, 3, 4, 5]);
    expect(inline()).toBe(6);
    expect(readAhead.decompressed).toEqual([]);
  });

  it("falls back to inline decompression when a read-ahead fails", async () => {
    // Given read-ahead whose decompression always fails
    const buffer = await writeFile(6);
    const readAhead = fakeReadAhead();
    readAhead.decompress = async () => {
      throw new Error("worker gone");
    };
    const { reader, inline } = await open(buffer, readAhead);

    // When the file is read, Then it reads fine, decompressing inline, and gives back its bytes
    await expect(collect(reader)).resolves.toEqual([0, 1, 2, 3, 4, 5]);
    expect(inline()).toBe(6);
    expect(readAhead.used()).toBe(0);
  });

  it("checks the CRC again when a validating read finds an unchecked chunk loaded ahead", async () => {
    // Given a file read once without CRC checks, its chunks cached unchecked
    const buffer = await writeFile(4);
    const readAhead = fakeReadAhead();
    const { reader, inline } = await open(buffer, readAhead);
    await collect(reader);
    const loads = () => inline() + readAhead.decompressed.length;
    const before = loads();

    // When it is read again with CRC checks
    await expect(collect(reader, { validateCrcs: true })).resolves.toEqual([0, 1, 2, 3]);

    // Then every chunk is loaded (and checked) again
    expect(loads() - before).toBe(4);
  });
});
