// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { CHUNK_CACHE_BYTES, ChunkCache } from "./ChunkCache.ts";
import { ChunkMessageIndex } from "./ChunkCursor.ts";

const view = (bytes: number) => new DataView(new ArrayBuffer(bytes));

describe("ChunkCache", () => {
  it("returns the same DataView it was given", () => {
    // McapIndexedReader tracks chunks cached without a CRC check by DataView identity
    const cache = new ChunkCache();
    const data = view(8);
    cache.set(0n, data);
    expect(cache.get(0n)).toBe(data);
  });

  it("evicts the least recently used chunks past its budget", () => {
    // Given three chunks that fill the budget, the first of them read again since
    const cache = new ChunkCache();
    const third = CHUNK_CACHE_BYTES / 3;
    cache.set(0n, view(third));
    cache.set(1n, view(third));
    cache.set(2n, view(third));
    cache.get(0n);

    // When a fourth comes in
    cache.set(3n, view(third));

    // Then the least recently used one goes
    expect(cache.get(1n)).toBeUndefined();
    expect(cache.get(0n)).toBeDefined();
    expect(cache.get(3n)).toBeDefined();
    cache.clear();
  });

  it("keeps a chunk's records when its message indexes are added, however big", () => {
    // Given a chunk larger than the whole budget
    const cache = new ChunkCache();
    cache.set(0n, view(CHUNK_CACHE_BYTES + 1));

    // When its message indexes are added
    cache.setMessageIndexes(0n, view(16));

    // Then both stay
    expect(cache.get(0n)).toBeDefined();
    expect(cache.getMessageIndexes(0n)).toBeDefined();
    cache.clear();
  });

  it("keeps a chunk that fills the budget when its parsed index is added", () => {
    // Given a chunk as big as the budget
    const cache = new ChunkCache();
    const index = new ChunkMessageIndex(
      new BigUint64Array(1),
      new Float64Array(1),
      new Uint16Array(1),
    );
    cache.set(0n, view(CHUNK_CACHE_BYTES));

    // When its index is added on every read
    for (let read = 0; read < 2; read++) {
      cache.setChunkMessageIndex(7n, index);

      // Then both stay, so the chunk is not decompressed again
      expect(cache.get(0n)).toBeDefined();
      expect(cache.getChunkMessageIndex(7n)).toBe(index);
    }
    cache.clear();
  });

  it("counts parsed message indexes against the budget", () => {
    // Given a parsed index and chunks that together overflow the budget
    const cache = new ChunkCache();
    const index = new ChunkMessageIndex(
      new BigUint64Array(1),
      new Float64Array(1),
      new Uint16Array(1),
    );
    cache.setChunkMessageIndex(7n, index);
    cache.set(0n, view(CHUNK_CACHE_BYTES / 2));

    // When the budget is reached
    cache.set(1n, view(CHUNK_CACHE_BYTES / 2));

    // Then the oldest entry, the index, goes
    expect(cache.getChunkMessageIndex(7n)).toBeUndefined();
    expect(cache.get(0n)).toBeDefined();
    cache.clear();
  });
});
