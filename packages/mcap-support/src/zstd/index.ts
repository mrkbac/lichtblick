// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import zstdWasmUrl from "./zstd.wasm";

type ZstdExports = {
  memory: WebAssembly.Memory;
  /** Runs static constructors; must be called once before anything else */
  _initialize: () => void;
  /** First free byte after the stack and static data */
  __heap_base: WebAssembly.Global;
  /** Returns the decompressed size, or -1 on error */
  decompress: (dst: number, dstCapacity: number, src: number, srcSize: number) => number;
};

export type ZstdDecompress = (src: Uint8Array, decompressedSize: number) => Uint8Array;

/**
 * Loads the zstd decompressor built by build.sh. Each call copies `src` into wasm memory,
 * decompresses after it, and returns a fresh copy of the output. The wasm memory grows to the
 * largest input + output seen and never shrinks.
 */
export async function loadZstdDecompress(): Promise<ZstdDecompress> {
  const response = await fetch(zstdWasmUrl);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
  const wasm = instance.exports as unknown as ZstdExports;
  // eslint-disable-next-line no-underscore-dangle -- wasm-ld export name
  wasm._initialize();
  // eslint-disable-next-line no-underscore-dangle -- wasm-ld export name
  const srcOffset = wasm.__heap_base.value as number;
  let heap = new Uint8Array(wasm.memory.buffer);

  return (src, decompressedSize) => {
    const dstOffset = Math.ceil((srcOffset + src.byteLength) / 16) * 16;
    const end = dstOffset + decompressedSize;
    if (end > heap.byteLength) {
      wasm.memory.grow(Math.ceil((end - heap.byteLength) / 65536));
      heap = new Uint8Array(wasm.memory.buffer);
    }
    heap.set(src, srcOffset);
    const size = wasm.decompress(dstOffset, decompressedSize, srcOffset, src.byteLength);
    if (size < 0) {
      throw new Error("zstd: decompression failed");
    }
    return heap.slice(dstOffset, dstOffset + size);
  };
}
