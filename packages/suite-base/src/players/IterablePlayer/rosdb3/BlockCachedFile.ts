// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** Bytes FileReaderSync reads at a time */
export const BLOCK_SIZE = 1024 * 1024;
/** Blocks kept, shared by every open file */
const MAX_BLOCKS = 8;

// Most recently used last
const blocks = new Map<string, Uint8Array>();
let nextFileId = 0;

/** What BlockCachedFile.slice() hands sql.js in place of a Blob */
class SliceRef {
  /** Read by sql.js */
  public readonly size: number;

  public constructor(
    public readonly file: BlockCachedFile,
    public readonly start: number,
    public readonly end: number,
  ) {
    this.size = end - start;
  }
}

/**
 * A File for sql.js's file-backed database that reads the file in 1 MiB blocks.
 *
 * sql.js reads such a database one SQLite page (4 KiB) at a time, each with its own
 * FileReaderSync call (its WORKERFS). In Chrome a FileReaderSync call costs ~250 µs whatever its
 * size, which caps reading at ~16 MB/s; 1 MiB reads run at ~1 GB/s. So slice() returns a SliceRef
 * and the FileReaderSync installed by installBlockFileReaderSync() serves it from cached blocks.
 */
export class BlockCachedFile extends File {
  readonly #file: Blob;
  readonly #id = nextFileId++;
  #reader: FileReaderSync | undefined;

  public constructor(file: File) {
    // A File made of the File refers to its data without copying it, and has its size
    super([file], file.name, { lastModified: file.lastModified });
    this.#file = file;
    installBlockFileReaderSync();
  }

  public override slice(start = 0, end = this.size): Blob {
    return new SliceRef(this, start, Math.min(end, this.size)) as unknown as Blob;
  }

  public read(start: number, end: number): ArrayBuffer {
    const out = new Uint8Array(Math.max(0, end - start));
    for (let pos = start; pos < end; ) {
      const index = Math.floor(pos / BLOCK_SIZE);
      const block = this.#block(index);
      const from = pos - index * BLOCK_SIZE;
      const n = Math.min(end - pos, block.byteLength - from);
      if (n <= 0) {
        break;
      }
      out.set(block.subarray(from, from + n), pos - start);
      pos += n;
    }
    return out.buffer;
  }

  #block(index: number): Uint8Array {
    const key = `${this.#id}:${index}`;
    let block = blocks.get(key);
    if (block) {
      blocks.delete(key);
    } else {
      this.#reader ??= new RealFileReaderSync!();
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

let RealFileReaderSync: typeof FileReaderSync | undefined;

/**
 * Lets sql.js read BlockCachedFile slices: sql.js makes its FileReaderSync from the global one
 * when it opens the first file-backed database, which comes after the first BlockCachedFile.
 * Other Blobs still go to the real FileReaderSync.
 */
function installBlockFileReaderSync(): void {
  if (RealFileReaderSync != undefined) {
    return;
  }
  const Real = (RealFileReaderSync = globalThis.FileReaderSync);
  globalThis.FileReaderSync = class extends Real {
    public override readAsArrayBuffer(blob: Blob): ArrayBuffer {
      return blob instanceof SliceRef
        ? blob.file.read(blob.start, blob.end)
        : super.readAsArrayBuffer(blob);
    }
  };
}
