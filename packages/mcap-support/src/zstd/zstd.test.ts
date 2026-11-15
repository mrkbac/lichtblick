// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import zlib from "node:zlib";

import { loadZstdDecompress, ZstdDecompress } from "./index";

const { ZSTD_c_compressionLevel, ZSTD_c_checksumFlag } = zlib.constants;

function compress(data: Uint8Array, level: number, { checksum = false } = {}): Uint8Array {
  return zlib.zstdCompressSync(data, {
    params: { [ZSTD_c_compressionLevel]: level, [ZSTD_c_checksumFlag]: checksum ? 1 : 0 },
  });
}

/** Repetitive but not trivial bytes, so frames have literals, matches and long offsets */
function sampleData(size: number, seed: number): Uint8Array {
  const data = new Uint8Array(size);
  let state = seed;
  for (let i = 0; i < size; i++) {
    state = (state * 1103515245 + 12345) >>> 0;
    data[i] = i >= 4096 && state % 4 !== 0 ? data[i - 4096 + (state % 64)]! : state >>> 24;
  }
  return data;
}

describe("loadZstdDecompress", () => {
  let decompress: ZstdDecompress;
  beforeAll(async () => {
    decompress = await loadZstdDecompress();
  });

  it.each([
    { size: 0, level: 3 },
    { size: 1, level: 3 },
    { size: 100_000, level: 1 },
    { size: 1_000_000, level: 3 },
    { size: 3_000_000, level: 19 },
  ])("round-trips $size bytes at level $level", ({ size, level }) => {
    const data = sampleData(size, size + level);
    expect(decompress(compress(data, level), size)).toEqual(data);
  });

  it("verifies frame checksums", () => {
    const frame = compress(sampleData(50_000, 1), 3, { checksum: true });
    expect(decompress(frame, 50_000)).toEqual(sampleData(50_000, 1));
    const corrupt = frame.slice();
    corrupt[corrupt.length - 1]! ^= 0xff; // the checksum is the last 4 bytes
    expect(() => decompress(corrupt, 50_000)).toThrow("zstd: decompression failed");
  });

  it("returns independent buffers as wasm memory grows and is reused", () => {
    const big = sampleData(8_000_000, 2);
    const small = sampleData(10_000, 3);
    const first = decompress(compress(small, 3), small.length);
    const second = decompress(compress(big, 3), big.length);
    const third = decompress(compress(small.slice().reverse(), 3), small.length);
    expect(first).toEqual(small);
    expect(second).toEqual(big);
    expect(third).toEqual(small.slice().reverse());
    expect(first.buffer).not.toBe(second.buffer);
  });

  it("decompresses concatenated frames", () => {
    const a = sampleData(20_000, 4);
    const b = sampleData(30_000, 5);
    const frames = new Uint8Array([...compress(a, 3), ...compress(b, 3)]);
    expect(decompress(frames, a.length + b.length)).toEqual(new Uint8Array([...a, ...b]));
  });

  it("throws on corrupt input or a too-small output size, and keeps working after", () => {
    const data = sampleData(200_000, 6);
    const frame = compress(data, 3);
    expect(() => decompress(frame.subarray(0, frame.length / 2), data.length)).toThrow(
      "zstd: decompression failed",
    );
    expect(() => decompress(frame, data.length - 1)).toThrow("zstd: decompression failed");
    expect(() => decompress(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 10)).toThrow(
      "zstd: decompression failed",
    );
    expect(decompress(frame, data.length)).toEqual(data);
  });
});
