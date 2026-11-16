// SPDX-FileCopyrightText: Copyright (c) Foxglove Technologies Inc
// SPDX-License-Identifier: MIT

import * as _ from "lodash-es";

import { Opcode } from "./constants.ts";
import type { ChunkIndex, IReadable } from "./types.ts";

/** Offset of the low 32 bits of a uint64 in a Uint32Array view of it (typed arrays use host order) */
const LO = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 0 : 1;
const HI = 1 - LO;

/**
 * Every message of one chunk (all channels), sorted by logTime with ties broken by message offset.
 * Parsed once from the chunk's MessageIndex records, so it can be cached and shared by every
 * `readMessages()` call, whatever its topics and time range.
 */
export class ChunkMessageIndex {
  public readonly logTimes: BigUint64Array;
  /** Message record offsets in the decompressed chunk */
  public readonly offsets: Float64Array;
  public readonly channelIds: Uint16Array;
  /** Bytes held, for cache budgets */
  public readonly byteLength: number;

  public constructor(logTimes: BigUint64Array, offsets: Float64Array, channelIds: Uint16Array) {
    this.logTimes = logTimes;
    this.offsets = offsets;
    this.channelIds = channelIds;
    this.byteLength = logTimes.byteLength + offsets.byteLength + channelIds.byteLength;
  }

  /** Parses a chunk's message index section (the MessageIndex records of all its channels). */
  public static parse(view: DataView, chunkIndex: ChunkIndex): ChunkMessageIndex {
    // Pass 1: find the entry lists and count the entries
    const lists: { channelId: number; start: number; count: number }[] = [];
    let total = 0;
    let pos = 0;
    while (view.byteLength - pos >= 9) {
      const opcode = view.getUint8(pos);
      const recordLength = view.getBigUint64(pos + 1, true);
      const start = pos + 9;
      if (recordLength > BigInt(view.byteLength - start)) {
        break;
      }
      const end = start + Number(recordLength);
      if (opcode === Opcode.MESSAGE_INDEX) {
        if (end - start < 6) {
          throw new Error(`MessageIndex record at offset ${pos} is too short`);
        }
        const length = view.getUint32(start + 2, true);
        if (length % 16 !== 0 || length > end - start - 6) {
          throw new Error(
            `MessageIndex record at offset ${pos} has invalid records length ${length}`,
          );
        }
        if (length > 0) {
          lists.push({
            channelId: view.getUint16(start, true),
            start: start + 6,
            count: length / 16,
          });
          total += length / 16;
        }
      }
      pos = end;
    }
    if (pos !== view.byteLength) {
      throw new Error(`${view.byteLength - pos} bytes remaining in message index section`);
    }

    // Pass 2: copy the entries out in file order
    const logTimes = new BigUint64Array(total);
    const words = new Uint32Array(logTimes.buffer);
    const offsets = new Float64Array(total);
    const channelIds = new Uint16Array(total);
    let i = 0;
    for (const { channelId, start, count } of lists) {
      for (let entry = start, end = start + count * 16; entry < end; entry += 16, i++) {
        words[2 * i + LO] = view.getUint32(entry, true);
        words[2 * i + HI] = view.getUint32(entry + 4, true);
        const offsetHi = view.getUint32(entry + 12, true);
        if (offsetHi >= 0x200000) {
          throw new Error(`Message offset at ${entry + 8} in message index is too large`);
        }
        offsets[i] = offsetHi * 0x100000000 + view.getUint32(entry + 8, true);
        channelIds[i] = channelId;
      }
    }
    return ChunkMessageIndex.#sorted(logTimes, offsets, channelIds, chunkIndex);
  }

  /**
   * Builds the index of a chunk without message indexes by scanning its decompressed records for
   * Message records, as the MCAP spec asks readers to do for such chunks.
   */
  public static scan(view: DataView, chunkIndex: ChunkIndex): ChunkMessageIndex {
    const found: { logTime: bigint; offset: number; channelId: number }[] = [];
    let pos = 0;
    while (view.byteLength - pos >= 9) {
      const opcode = view.getUint8(pos);
      const recordLength = view.getBigUint64(pos + 1, true);
      const start = pos + 9;
      if (recordLength > BigInt(view.byteLength - start)) {
        throw new Error(
          `Record at offset ${pos} in chunk at offset ${chunkIndex.chunkStartOffset} is truncated`,
        );
      }
      if (opcode === Opcode.MESSAGE) {
        // channel_id u16, sequence u32, log_time u64
        if (recordLength < 22n) {
          throw new Error(`Message record at offset ${pos} is too short`);
        }
        found.push({
          logTime: view.getBigUint64(start + 6, true),
          offset: pos,
          channelId: view.getUint16(start, true),
        });
      }
      pos = start + Number(recordLength);
    }
    const logTimes = new BigUint64Array(found.length);
    const offsets = new Float64Array(found.length);
    const channelIds = new Uint16Array(found.length);
    for (let i = 0; i < found.length; i++) {
      logTimes[i] = found[i]!.logTime;
      offsets[i] = found[i]!.offset;
      channelIds[i] = found[i]!.channelId;
    }
    return ChunkMessageIndex.#sorted(logTimes, offsets, channelIds, chunkIndex);
  }

  /** Sorts entries by logTime then offset (unless already sorted) and checks the chunk's times */
  static #sorted(
    logTimes: BigUint64Array,
    offsets: Float64Array,
    channelIds: Uint16Array,
    chunkIndex: ChunkIndex,
  ): ChunkMessageIndex {
    const total = logTimes.length;
    const words = new Uint32Array(logTimes.buffer);
    // Already sorted for one channel, or channels that don't overlap in time
    let sorted = true;
    for (let i = 1; i < total && sorted; i++) {
      sorted = compareEntries(words, offsets, i - 1, i) <= 0;
    }
    if (sorted) {
      return ChunkMessageIndex.#checked(logTimes, offsets, channelIds, chunkIndex);
    }
    const order = new Uint32Array(total);
    for (let j = 0; j < total; j++) {
      order[j] = j;
    }
    order.sort((a, b) => compareEntries(words, offsets, a, b));
    const sortedLogTimes = new BigUint64Array(total);
    const sortedWords = new Uint32Array(sortedLogTimes.buffer);
    const sortedOffsets = new Float64Array(total);
    const sortedChannelIds = new Uint16Array(total);
    for (let j = 0; j < total; j++) {
      const from = order[j]!;
      sortedWords[2 * j] = words[2 * from]!;
      sortedWords[2 * j + 1] = words[2 * from + 1]!;
      sortedOffsets[j] = offsets[from]!;
      sortedChannelIds[j] = channelIds[from]!;
    }
    return ChunkMessageIndex.#checked(sortedLogTimes, sortedOffsets, sortedChannelIds, chunkIndex);
  }

  /** Checks that sorted entries lie within the chunk's message times */
  static #checked(
    logTimes: BigUint64Array,
    offsets: Float64Array,
    channelIds: Uint16Array,
    chunkIndex: ChunkIndex,
  ): ChunkMessageIndex {
    const total = logTimes.length;
    if (total > 0) {
      const first = logTimes[0]!;
      if (first < chunkIndex.messageStartTime) {
        throw new Error(
          `Chunk at offset ${chunkIndex.chunkStartOffset} contains a message with logTime (${first}) earlier than chunk messageStartTime (${chunkIndex.messageStartTime})`,
        );
      }
      const last = logTimes[total - 1]!;
      if (last > chunkIndex.messageEndTime) {
        throw new Error(
          `Chunk at offset ${chunkIndex.chunkStartOffset} contains a message with logTime (${last}) later than chunk messageEndTime (${chunkIndex.messageEndTime})`,
        );
      }
    }
    return new ChunkMessageIndex(logTimes, offsets, channelIds);
  }
}

/** Orders entries `a` and `b` by logTime, then by offset */
function compareEntries(words: Uint32Array, offsets: Float64Array, a: number, b: number): number {
  const hi = words[2 * a + HI]! - words[2 * b + HI]!;
  if (hi !== 0) {
    return hi;
  }
  const lo = words[2 * a + LO]! - words[2 * b + LO]!;
  return lo !== 0 ? lo : offsets[a]! - offsets[b]!;
}

/** Parsed message indexes by message index section offset. See `ChunkDataCache`. */
export type ChunkMessageIndexCache = {
  getChunkMessageIndex?(messageIndexStartOffset: bigint): ChunkMessageIndex | undefined;
  setChunkMessageIndex?(
    messageIndexStartOffset: bigint,
    index: ChunkMessageIndex,
    chunkStartOffset: bigint,
  ): void;
};

type ChunkCursorParams = {
  chunkIndex: ChunkIndex;
  relevantChannels: Set<number> | undefined;
  startingAt: bigint | undefined;
  endingAt: bigint | undefined;
  reverse: boolean;
};

/**
 * ChunkCursor represents the reader's position in a particular chunk. The indexed reader holds
 * ChunkCursors in a heap in order to merge multiple chunks together.
 *
 * The cursor walks the chunk's ChunkMessageIndex within the time range, skipping messages on
 * channels that aren't relevant.
 */
export class ChunkCursor {
  public readonly chunkIndex: ChunkIndex;

  #relevantChannels?: Set<number>;
  #startingAt: bigint | undefined;
  #endingAt: bigint | undefined;
  #reverse: boolean;

  #index?: ChunkMessageIndex;
  // Next entry of #index to pop, moving by #step; done once it leaves [#first, #last]
  #next = 0;
  #first = 0;
  #last = -1;
  #step: 1 | -1;

  public constructor(params: ChunkCursorParams) {
    this.chunkIndex = params.chunkIndex;
    this.#relevantChannels = params.relevantChannels;
    this.#startingAt = params.startingAt;
    this.#endingAt = params.endingAt;
    this.#reverse = params.reverse;
    this.#step = params.reverse ? -1 : 1;
  }

  /**
   * Returns `< 0` if the callee's next available message logTime is earlier than `other`'s, `> 0`
   * for the opposite case. Never returns `0` because ties are broken by the chunks' offsets in the
   * file.
   *
   * Cursors that still need `loadMessageIndexes()` are sorted earlier so the caller can load them
   * and re-sort the cursors.
   */
  public compare(other: ChunkCursor): number {
    if (this.#reverse !== other.#reverse) {
      throw new Error("Cannot compare a reversed ChunkCursor to a non-reversed ChunkCursor");
    }

    let diff = Number(this.#getSortTime() - other.#getSortTime());

    // Break ties by chunk offset in the file
    if (diff === 0) {
      diff = Number(this.chunkIndex.chunkStartOffset - other.chunkIndex.chunkStartOffset);
    }

    return this.#reverse ? -diff : diff;
  }

  /**
   * Returns true if there are more messages available in the chunk. Message indexes must have been
   * loaded before using this method.
   */
  public hasMoreMessages(): boolean {
    if (this.#index == undefined) {
      throw new Error("loadMessageIndexes() must be called before hasMore()");
    }
    return this.#next >= this.#first && this.#next <= this.#last;
  }

  /**
   * Pop a message off of the chunk cursor and return its entry in `messageIndex`. Message indexes
   * must have been loaded before using this method.
   */
  public popMessage(): number {
    if (!this.hasMoreMessages()) {
      throw new Error(
        `Unexpected popMessage() call when no more messages are available, in chunk at offset ${this.chunkIndex.chunkStartOffset}`,
      );
    }
    const entry = this.#next;
    this.#next += this.#step;
    this.#skipIrrelevant();
    return entry;
  }

  /** The chunk's message index, once `loadMessageIndexes()` has been called */
  public messageIndex(): ChunkMessageIndex {
    if (this.#index == undefined) {
      throw new Error("loadMessageIndexes() must be called before messageIndex()");
    }
    return this.#index;
  }

  /**
   * Returns true if message indexes have been loaded, false if `loadMessageIndexes()` needs to be
   * called.
   */
  public hasMessageIndexes(): boolean {
    return this.#index != undefined;
  }

  /**
   * Loads the chunk's message index. A chunk without message indexes (allowed by the spec) is
   * indexed by scanning its records, which `loadChunk` loads.
   */
  public async loadMessageIndexes<TReadOptions>(
    readable: IReadable<TReadOptions>,
    loadChunk: () => Promise<DataView>,
    readOptions?: TReadOptions,
    cache?: ChunkMessageIndexCache,
  ): Promise<void> {
    if (this.chunkIndex.messageIndexOffsets.size === 0 && this.chunkIndex.uncompressedSize > 0n) {
      // Keyed by the chunk's start offset, which no message index section can have
      const key = this.chunkIndex.chunkStartOffset;
      let index = cache?.getChunkMessageIndex?.(key);
      if (!index) {
        index = ChunkMessageIndex.scan(await loadChunk(), this.chunkIndex);
        cache?.setChunkMessageIndex?.(key, index, key);
      }
      this.#setIndex(index);
      return;
    }

    let messageIndexStartOffset: bigint | undefined;
    let anyRelevant = false;
    let allRelevant = true;
    for (const [channelId, offset] of this.chunkIndex.messageIndexOffsets) {
      if (messageIndexStartOffset == undefined || offset < messageIndexStartOffset) {
        messageIndexStartOffset = offset;
      }
      if (!this.#relevantChannels || this.#relevantChannels.has(channelId)) {
        anyRelevant = true;
      } else {
        allRelevant = false;
      }
    }
    if (allRelevant) {
      this.#relevantChannels = undefined;
    }
    if (messageIndexStartOffset == undefined || !anyRelevant) {
      this.#index = new ChunkMessageIndex(
        new BigUint64Array(0),
        new Float64Array(0),
        new Uint16Array(0),
      );
      return;
    }

    let index = cache?.getChunkMessageIndex?.(messageIndexStartOffset);
    if (!index) {
      const bytes = await readable.read(
        messageIndexStartOffset,
        this.chunkIndex.messageIndexLength,
        readOptions,
      );
      index = ChunkMessageIndex.parse(
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        this.chunkIndex,
      );
      cache?.setChunkMessageIndex?.(
        messageIndexStartOffset,
        index,
        this.chunkIndex.chunkStartOffset,
      );
    }
    this.#setIndex(index);
  }

  #setIndex(index: ChunkMessageIndex): void {
    this.#index = index;
    // Entries within [startingAt, endingAt]
    this.#first =
      this.#startingAt == undefined ? 0 : _.sortedIndex(index.logTimes, this.#startingAt);
    this.#last =
      (this.#endingAt == undefined
        ? index.logTimes.length
        : _.sortedLastIndex(index.logTimes, this.#endingAt)) - 1;
    // Reverse iteration walks the entries backwards, so messages with the same logTime come in
    // descending offset order
    this.#next = this.#reverse ? this.#last : this.#first;
    this.#skipIrrelevant();
  }

  #skipIrrelevant(): void {
    const relevant = this.#relevantChannels;
    if (!relevant) {
      return;
    }
    const channelIds = this.#index!.channelIds;
    while (
      this.#next >= this.#first &&
      this.#next <= this.#last &&
      !relevant.has(channelIds[this.#next]!)
    ) {
      this.#next += this.#step;
    }
  }

  // Get the next available message logTime which is being used when comparing chunkCursors (for ordering purposes).
  #getSortTime(): bigint {
    // If message indexes have been loaded and are non-empty, we return the logTime of the next available message.
    if (this.#index != undefined && this.#next >= this.#first && this.#next <= this.#last) {
      return this.#index.logTimes[this.#next]!;
    }

    // Fall back to the chunk index' start time or end time.
    return this.#reverse ? this.chunkIndex.messageEndTime : this.chunkIndex.messageStartTime;
  }
}
