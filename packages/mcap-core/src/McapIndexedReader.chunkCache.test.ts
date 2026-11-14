// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapIndexedReader } from "./McapIndexedReader.ts";
import { McapWriter } from "./McapWriter.ts";
import { TempBuffer } from "./TempBuffer.ts";
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
