// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { ChunkMessageIndex } from "./ChunkCursor.ts";

/**
 * Bytes of decompressed chunks, parsed message indexes and rebuilt message indexes kept per worker,
 * for all its files
 */
export const CHUNK_CACHE_BYTES = 64 * 1024 * 1024;

// One LRU for every file in this worker (Map order: least recently used first), so memory stays
// bounded however many files are open
const entries = new Map<string, DataView | ChunkMessageIndex>();
let totalBytes = 0;
let nextId = 0;

/**
 * Decompressed chunks of one file by chunk start offset, shared by every McapIndexedReader on it
 * (see openCachedMcapReader): playback, preloading, plots and backfill each run their own
 * readMessages(), which on its own forgets a chunk as soon as it moves past it. Also holds message
 * indexes rebuilt for chunks of a recovered file (see McapRecoveryScanner), and each chunk's parsed
 * message index, which every readMessages() call would otherwise read, parse and sort again.
 */
export class ChunkCache {
  readonly #prefix = `${nextId++}:`;

  /** For McapIndexedReader's `chunkCache` option */
  public get(chunkStartOffset: bigint): DataView | undefined {
    return this.#get(`c${chunkStartOffset}`) as DataView | undefined;
  }

  public set(chunkStartOffset: bigint, data: DataView): void {
    this.#set(`c${chunkStartOffset}`, data);
  }

  public getMessageIndexes(chunkStartOffset: bigint): DataView | undefined {
    return this.#get(`i${chunkStartOffset}`) as DataView | undefined;
  }

  public setMessageIndexes(chunkStartOffset: bigint, data: DataView): void {
    this.#set(`i${chunkStartOffset}`, data);
  }

  /** For McapIndexedReader's `chunkCache` option. Keyed by the message index section's offset. */
  public getChunkMessageIndex(messageIndexStartOffset: bigint): ChunkMessageIndex | undefined {
    return this.#get(`m${messageIndexStartOffset}`) as ChunkMessageIndex | undefined;
  }

  public setChunkMessageIndex(messageIndexStartOffset: bigint, index: ChunkMessageIndex): void {
    this.#set(`m${messageIndexStartOffset}`, index);
  }

  /** Drops this file's entries */
  public clear(): void {
    for (const [key, data] of entries) {
      if (key.startsWith(this.#prefix)) {
        entries.delete(key);
        totalBytes -= data.byteLength;
      }
    }
  }

  #get(key: string): DataView | ChunkMessageIndex | undefined {
    const fullKey = this.#prefix + key;
    const data = entries.get(fullKey);
    if (data) {
      entries.delete(fullKey); // most recently used goes last
      entries.set(fullKey, data);
    }
    return data;
  }

  #set(key: string, data: DataView | ChunkMessageIndex): void {
    const fullKey = this.#prefix + key;
    const old = entries.get(fullKey);
    if (old) {
      entries.delete(fullKey);
      totalBytes -= old.byteLength;
    }
    entries.set(fullKey, data);
    totalBytes += data.byteLength;
    const kind = key[0];
    // A parsed index is small next to its chunk and is added just before it is read, so it never
    // evicts: evicting the chunk would make every read decompress it again. The next chunk added
    // brings the total back under budget.
    if (kind === "m") {
      return;
    }
    // Oldest first. Always keeps the newest, however big, and the other half of a recovered chunk
    // (its records or rebuilt message indexes), so adding one never evicts the other.
    const sibling = this.#prefix + (kind === "c" ? "i" : "c") + key.slice(1);
    for (const [oldKey, oldData] of entries) {
      if (totalBytes <= CHUNK_CACHE_BYTES || oldKey === fullKey) {
        break;
      }
      if (oldKey !== sibling) {
        entries.delete(oldKey);
        totalBytes -= oldData.byteLength;
      }
    }
  }
}
