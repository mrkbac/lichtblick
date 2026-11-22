// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** Bytes FileReaderSync reads at a time */
export const BLOCK_SIZE = 1024 * 1024;
/** Blocks kept, shared by every open file */
const MAX_BLOCKS = 8;

// Most recently used last
const blocks = new Map<string, Uint8Array>();
let nextFileId = 0;

/** Batches synchronous file I/O when SQLite requests one page at a time. */
export class BlockCachedFile {
  readonly #file: File;
  readonly #id = nextFileId++;
  readonly #reader = new FileReaderSync();
  public readonly size: number;

  public constructor(file: File) {
    this.#file = file;
    this.size = file.size;
  }

  public readInto(out: Uint8Array, offset: number): number {
    const end = Math.min(offset + out.byteLength, this.size);
    for (let pos = offset; pos < end; ) {
      const index = Math.floor(pos / BLOCK_SIZE);
      const block = this.#block(index);
      const from = pos - index * BLOCK_SIZE;
      const n = Math.min(end - pos, block.byteLength - from);
      if (n <= 0) {
        return pos - offset;
      }
      out.set(block.subarray(from, from + n), pos - offset);
      pos += n;
    }
    return Math.max(0, end - offset);
  }

  #block(index: number): Uint8Array {
    const key = `${this.#id}:${index}`;
    let block = blocks.get(key);
    if (block) {
      blocks.delete(key);
    } else {
      const start = index * BLOCK_SIZE;
      block = new Uint8Array(
        this.#reader.readAsArrayBuffer(this.#file.slice(start, start + BLOCK_SIZE)),
      );
      if (blocks.size >= MAX_BLOCKS) {
        blocks.delete(blocks.keys().next().value!);
      }
    }
    blocks.set(key, block);
    return block;
  }
}
