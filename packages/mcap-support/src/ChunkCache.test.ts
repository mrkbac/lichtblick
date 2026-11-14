// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { CHUNK_CACHE_BYTES, ChunkCache } from "./ChunkCache";

const view = (bytes: number) => new DataView(new ArrayBuffer(bytes));

describe("ChunkCache", () => {
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
});
