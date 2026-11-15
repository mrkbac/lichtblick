// SPDX-FileCopyrightText: Copyright (c) Foxglove Technologies Inc
// SPDX-License-Identifier: MIT

import { crc32, crc32Final, crc32Init, crc32Update } from "@foxglove/crc";
import { Heap } from "heap-js";

import { ChunkCursor } from "./ChunkCursor.ts";
import McapByteReader from "./McapByteReader.ts";
import { MCAP_MAGIC } from "./constants.ts";
import { parseMagic, parseRecord } from "./parse.ts";
import type {
  AttachmentIndex,
  Channel,
  ChunkIndex,
  DecompressHandlers,
  IReadable,
  MetadataIndex,
  Schema,
  Statistics,
  TypedMcapRecords,
} from "./types.ts";

/**
 * Chunk views cached by a read with `validateCrcs: false`. The first read that validates CRCs
 * loads and checks such a chunk again instead of trusting the cached copy.
 */
const uncheckedChunks = new WeakSet<DataView>();

/**
 * Decompresses chunks a `readMessages()` call will reach soon, off the calling thread, so it finds
 * them ready instead of decompressing each one when it gets there. Only read-ahead goes here: a
 * chunk a read needs right away (its first one, after a seek) is decompressed inline as without it.
 */
export type ChunkReadAhead = {
  /** How many chunks past the one a read is at it keeps loading ahead */
  readonly chunks: number;
  /**
   * Takes `bytes` (a chunk's compressed plus decompressed size) from the read-ahead memory cap.
   * False when they don't fit or no decompressor is ready; that chunk then isn't loaded ahead.
   */
  reserve(bytes: number): boolean;
  /** Gives back bytes taken by `reserve()`, once the chunk is loaded or its load failed */
  release(bytes: number): void;
  /** `buffer` is the caller's own copy, so it can be transferred to another thread */
  decompress(
    compression: string,
    buffer: Uint8Array,
    decompressedSize: bigint,
  ): Promise<Uint8Array>;
};

/** Decompressed chunk data keyed by chunk start offset. See `McapIndexedReader.Initialize`. */
export type ChunkDataCache = {
  get(chunkStartOffset: bigint): DataView | undefined;
  set(chunkStartOffset: bigint, data: DataView): void;
  /** Loads chunks ahead of every read on this cache, see ChunkReadAhead */
  readonly readAhead?: ChunkReadAhead;
};

type McapIndexedReaderArgs<TReadOptions = unknown> = {
  readable: IReadable<TReadOptions>;
  chunkIndexes: ChunkIndex[];
  attachmentIndexes: AttachmentIndex[];
  metadataIndexes: MetadataIndex[];
  statistics: Statistics | undefined;
  decompressHandlers?: DecompressHandlers;
  channelsById: Map<number, Channel>;
  schemasById: Map<number, Schema>;
  summaryOffsetsByOpcode: ReadonlyMap<number, TypedMcapRecords["SummaryOffset"]>;
  header: TypedMcapRecords["Header"];
  footer: TypedMcapRecords["Footer"];
  dataEndOffset: bigint;
  dataSectionCrc?: number;
  /**
   * Decompressed chunk data by chunk start offset, shared across calls to `readMessages()` (and
   * across readers of the same file). Consulted before a chunk is read and decompressed, and
   * filled after. The cache decides what to keep.
   */
  chunkCache?: ChunkDataCache;
};

/** Index records to add to an open reader, see `McapIndexedReader.appendIndex` */
export type McapIndexAppend = {
  chunkIndexes?: Iterable<ChunkIndex>;
  attachmentIndexes?: Iterable<AttachmentIndex>;
  metadataIndexes?: Iterable<MetadataIndex>;
  /** Added, or replacing the one with the same id */
  channels?: Iterable<Channel>;
  /** Added, or replacing the one with the same id */
  schemas?: Iterable<Schema>;
  /** Replaces the statistics */
  statistics?: Statistics;
};

export class McapIndexedReader<TReadOptions = unknown> {
  public readonly summaryOffsetsByOpcode: ReadonlyMap<number, TypedMcapRecords["SummaryOffset"]>;
  public readonly header: TypedMcapRecords["Header"];
  public readonly footer: TypedMcapRecords["Footer"];
  // Used for appending attachments/metadata to existing MCAP files
  public readonly dataEndOffset: bigint;
  public readonly dataSectionCrc?: number;

  #chunkIndexes: ChunkIndex[];
  #attachmentIndexes: AttachmentIndex[];
  #metadataIndexes: MetadataIndex[];
  #channelsById: Map<number, Channel>;
  #schemasById: Map<number, Schema>;
  #statistics: Statistics | undefined;

  #readable: IReadable<TReadOptions>;
  #decompressHandlers?: DecompressHandlers;
  #chunkCache?: ChunkDataCache;
  /** Chunks being loaded ahead, by chunk start offset; undefined if that load failed */
  #loadingAhead = new Map<bigint, Promise<DataView | undefined>>();

  #messageStartTime: bigint | undefined;
  #messageEndTime: bigint | undefined;
  #attachmentStartTime: bigint | undefined;
  #attachmentEndTime: bigint | undefined;

  private constructor(args: McapIndexedReaderArgs<TReadOptions>) {
    this.#readable = args.readable;
    this.#chunkIndexes = args.chunkIndexes;
    this.#attachmentIndexes = args.attachmentIndexes;
    this.#metadataIndexes = args.metadataIndexes;
    this.#statistics = args.statistics;
    this.#decompressHandlers = args.decompressHandlers;
    this.#chunkCache = args.chunkCache;
    this.#channelsById = args.channelsById;
    this.#schemasById = args.schemasById;
    this.summaryOffsetsByOpcode = args.summaryOffsetsByOpcode;
    this.header = args.header;
    this.footer = args.footer;
    this.dataEndOffset = args.dataEndOffset;
    this.dataSectionCrc = args.dataSectionCrc;
    for (const chunk of args.chunkIndexes) {
      this.#addChunkTimes(chunk);
    }
    for (const attachment of args.attachmentIndexes) {
      this.#addAttachmentTimes(attachment);
    }
  }

  public get chunkIndexes(): readonly ChunkIndex[] {
    return this.#chunkIndexes;
  }
  public get attachmentIndexes(): readonly AttachmentIndex[] {
    return this.#attachmentIndexes;
  }
  public get metadataIndexes(): readonly MetadataIndex[] {
    return this.#metadataIndexes;
  }
  public get channelsById(): ReadonlyMap<number, Channel> {
    return this.#channelsById;
  }
  public get schemasById(): ReadonlyMap<number, Schema> {
    return this.#schemasById;
  }
  public get statistics(): Statistics | undefined {
    return this.#statistics;
  }

  /**
   * Adds to the index, e.g. of a file that is still being written. Later reads, including reads
   * without time bounds, see what was added. Costs O(what is added).
   */
  public appendIndex(added: McapIndexAppend): void {
    // Loops, not push(...): a spread of a long list overflows the call stack. Each input is
    // copied first, so passing this reader's own arrays doesn't loop forever.
    for (const chunk of Array.from(added.chunkIndexes ?? [])) {
      this.#chunkIndexes.push(chunk);
      this.#addChunkTimes(chunk);
    }
    for (const attachment of Array.from(added.attachmentIndexes ?? [])) {
      this.#attachmentIndexes.push(attachment);
      this.#addAttachmentTimes(attachment);
    }
    for (const metadata of Array.from(added.metadataIndexes ?? [])) {
      this.#metadataIndexes.push(metadata);
    }
    for (const channel of added.channels ?? []) {
      this.#channelsById.set(channel.id, channel);
    }
    for (const schema of added.schemas ?? []) {
      this.#schemasById.set(schema.id, schema);
    }
    if (added.statistics) {
      this.#statistics = added.statistics;
    }
  }

  /** Replaces the chunk indexes (e.g. to drop corrupt chunks), and the message time range with them */
  public setChunkIndexes(chunkIndexes: readonly ChunkIndex[]): void {
    this.#chunkIndexes = [...chunkIndexes];
    this.#messageStartTime = undefined;
    this.#messageEndTime = undefined;
    for (const chunk of chunkIndexes) {
      this.#addChunkTimes(chunk);
    }
  }

  #addChunkTimes(chunk: ChunkIndex): void {
    if (this.#messageStartTime == undefined || chunk.messageStartTime < this.#messageStartTime) {
      this.#messageStartTime = chunk.messageStartTime;
    }
    if (this.#messageEndTime == undefined || chunk.messageEndTime > this.#messageEndTime) {
      this.#messageEndTime = chunk.messageEndTime;
    }
  }

  #addAttachmentTimes(attachment: AttachmentIndex): void {
    if (this.#attachmentStartTime == undefined || attachment.logTime < this.#attachmentStartTime) {
      this.#attachmentStartTime = attachment.logTime;
    }
    if (this.#attachmentEndTime == undefined || attachment.logTime > this.#attachmentEndTime) {
      this.#attachmentEndTime = attachment.logTime;
    }
  }

  #errorWithLibrary(message: string): Error {
    return new Error(`${message} [library=${this.header.library}]`);
  }

  public static async Initialize<TReadOptions = unknown>({
    readable,
    decompressHandlers,
    chunkCache,
    readOptions,
  }: {
    readable: IReadable<TReadOptions>;

    /**
     * When a compressed chunk is encountered, the entry in `decompressHandlers` corresponding to the
     * compression will be called to decompress the chunk data.
     */
    decompressHandlers?: DecompressHandlers;
    /**
     * Decompressed chunk data by chunk start offset, shared across calls to `readMessages()` (and
     * across readers of the same file). Consulted before a chunk is read and decompressed, and
     * filled after. The cache decides what to keep.
     */
    chunkCache?: ChunkDataCache;
    /**
     * Opaque options passed to each `readable.read()` call during initialization.
     */
    readOptions?: TReadOptions;
  }): Promise<McapIndexedReader<TReadOptions>> {
    const size = await readable.size();

    let header: TypedMcapRecords["Header"];
    let headerEndOffset: bigint;
    {
      const headerPrefix = await readable.read(
        0n,
        BigInt(MCAP_MAGIC.length + /* Opcode.HEADER */ 1 + /* record content length */ 8),
        readOptions,
      );
      const headerPrefixView = new DataView(
        headerPrefix.buffer,
        headerPrefix.byteOffset,
        headerPrefix.byteLength,
      );
      void parseMagic(new McapByteReader(headerPrefixView));
      const headerContentLength = headerPrefixView.getBigUint64(
        MCAP_MAGIC.length + /* Opcode.HEADER */ 1,
        true,
      );
      const headerReadLength =
        /* Opcode.HEADER */ 1n + /* record content length */ 8n + headerContentLength;

      const headerRecord = await readable.read(
        BigInt(MCAP_MAGIC.length),
        headerReadLength,
        readOptions,
      );
      headerEndOffset = BigInt(MCAP_MAGIC.length) + headerReadLength;
      const headerReader = new McapByteReader(
        new DataView(headerRecord.buffer, headerRecord.byteOffset, headerRecord.byteLength),
      );
      const headerResult = parseRecord(headerReader, true);
      if (headerResult?.type !== "Header") {
        throw new Error(
          `Unable to read header at beginning of file; found ${headerResult?.type ?? "nothing"}`,
        );
      }
      if (headerReader.bytesRemaining() !== 0) {
        throw new Error(`${headerReader.bytesRemaining()} bytes remaining after parsing header`);
      }
      header = headerResult;
    }

    function errorWithLibrary(message: string): Error {
      return new Error(`${message} [library=${header.library}]`);
    }

    let footerOffset: bigint;
    let footerAndMagicView: DataView;
    {
      const headerLengthLowerBound = BigInt(
        MCAP_MAGIC.length +
          /* Opcode.HEADER */ 1 +
          /* record content length */ 8 +
          /* profile length */ 4 +
          /* library length */ 4,
      );
      const footerAndMagicReadLength = BigInt(
        /* Opcode.FOOTER */ 1 +
          /* record content length */ 8 +
          /* summaryStart */ 8 +
          /* summaryOffsetStart */ 8 +
          /* crc */ 4 +
          MCAP_MAGIC.length,
      );
      if (size < headerLengthLowerBound + footerAndMagicReadLength) {
        throw errorWithLibrary(`File size (${size}) is too small to be valid MCAP`);
      }
      footerOffset = size - footerAndMagicReadLength;
      const footerBuffer = await readable.read(footerOffset, footerAndMagicReadLength, readOptions);

      footerAndMagicView = new DataView(
        footerBuffer.buffer,
        footerBuffer.byteOffset,
        footerBuffer.byteLength,
      );
    }

    try {
      void parseMagic(
        new McapByteReader(footerAndMagicView, footerAndMagicView.byteLength - MCAP_MAGIC.length),
      );
    } catch (error) {
      throw errorWithLibrary((error as Error).message);
    }

    let footer: TypedMcapRecords["Footer"];
    {
      const footerReader = new McapByteReader(footerAndMagicView);
      const footerRecord = parseRecord(footerReader, true);
      if (footerRecord?.type !== "Footer") {
        throw errorWithLibrary(
          `Unable to read footer from end of file (offset ${footerOffset}); found ${
            footerRecord?.type ?? "nothing"
          }`,
        );
      }
      if (footerReader.bytesRemaining() !== MCAP_MAGIC.length) {
        throw errorWithLibrary(
          `${
            footerReader.bytesRemaining() - MCAP_MAGIC.length
          } bytes remaining after parsing footer`,
        );
      }
      footer = footerRecord;
    }
    if (footer.summaryStart === 0n) {
      throw errorWithLibrary("File is not indexed");
    }

    // Copy the footer prefix before reading the summary because calling readable.read() may reuse the buffer.
    const footerPrefix = new Uint8Array(
      /* Opcode.FOOTER */ 1 +
        /* record content length */ 8 +
        /* summary start */ 8 +
        /* summary offset start */ 8,
    );
    footerPrefix.set(
      new Uint8Array(
        footerAndMagicView.buffer,
        footerAndMagicView.byteOffset,
        footerPrefix.byteLength,
      ),
    );

    const dataEndLength =
      /* Opcode.DATA_END */ 1n + /* record content length */ 8n + /* data_section_crc */ 4n;

    const dataEndOffset = footer.summaryStart - dataEndLength;
    if (dataEndOffset < headerEndOffset) {
      throw errorWithLibrary(
        `Expected DataEnd position (summary start ${footer.summaryStart} - ${dataEndLength} = ${dataEndOffset}) to be after Header end offset (${headerEndOffset})`,
      );
    }

    // Future optimization: avoid holding whole summary blob in memory at once
    const dataEndAndSummarySection = await readable.read(
      dataEndOffset,
      footerOffset - dataEndOffset,
      readOptions,
    );
    if (footer.summaryCrc !== 0) {
      let summaryCrc = crc32Init();
      summaryCrc = crc32Update(
        summaryCrc,
        dataEndAndSummarySection.subarray(Number(dataEndLength)),
      );
      summaryCrc = crc32Update(summaryCrc, footerPrefix);
      summaryCrc = crc32Final(summaryCrc);
      if (summaryCrc !== footer.summaryCrc) {
        throw errorWithLibrary(
          `Incorrect summary CRC ${summaryCrc} (expected ${footer.summaryCrc})`,
        );
      }
    }

    const indexView = new DataView(
      dataEndAndSummarySection.buffer,
      dataEndAndSummarySection.byteOffset,
      dataEndAndSummarySection.byteLength,
    );
    const indexReader = new McapByteReader(indexView);

    const channelsById = new Map<number, TypedMcapRecords["Channel"]>();
    const schemasById = new Map<number, TypedMcapRecords["Schema"]>();
    const chunkIndexes: TypedMcapRecords["ChunkIndex"][] = [];
    const attachmentIndexes: TypedMcapRecords["AttachmentIndex"][] = [];
    const metadataIndexes: TypedMcapRecords["MetadataIndex"][] = [];
    const summaryOffsetsByOpcode = new Map<number, TypedMcapRecords["SummaryOffset"]>();
    let statistics: TypedMcapRecords["Statistics"] | undefined;
    let dataSectionCrc: number | undefined;

    let first = true;
    let result;
    while ((result = parseRecord(indexReader, true))) {
      if (first && result.type !== "DataEnd") {
        throw errorWithLibrary(
          `Expected DataEnd record to precede summary section, but found ${result.type}`,
        );
      }
      first = false;
      switch (result.type) {
        case "Schema":
          schemasById.set(result.id, result);
          break;
        case "Channel":
          channelsById.set(result.id, result);
          break;
        case "ChunkIndex":
          chunkIndexes.push(result);
          break;
        case "AttachmentIndex":
          attachmentIndexes.push(result);
          break;
        case "MetadataIndex":
          metadataIndexes.push(result);
          break;
        case "Statistics":
          if (statistics) {
            throw errorWithLibrary("Duplicate Statistics record");
          }
          statistics = result;
          break;
        case "SummaryOffset":
          summaryOffsetsByOpcode.set(result.groupOpcode, result);
          break;
        case "DataEnd":
          dataSectionCrc = result.dataSectionCrc === 0 ? undefined : result.dataSectionCrc;
          break;
        case "Header":
        case "Footer":
        case "Message":
        case "Chunk":
        case "MessageIndex":
        case "Attachment":
        case "Metadata":
          throw errorWithLibrary(`${result.type} record not allowed in index section`);
        case "Unknown":
          break;
      }
    }
    if (indexReader.bytesRemaining() !== 0) {
      throw errorWithLibrary(`${indexReader.bytesRemaining()} bytes remaining in index section`);
    }

    return new McapIndexedReader<TReadOptions>({
      readable,
      chunkIndexes,
      attachmentIndexes,
      metadataIndexes,
      statistics,
      decompressHandlers,
      channelsById,
      schemasById,
      summaryOffsetsByOpcode,
      header,
      footer,
      dataEndOffset,
      dataSectionCrc,
      chunkCache,
    });
  }

  /**
   * Read messages from the file, optionally filtering by topic and log time.
   * Provide at most one lower bound (`startingAt` or `startingAfter`) and one
   * upper bound (`endingAt` or `endingBefore`). The bounds resolve to a
   * half-open range `[start, end)`. `start > end` throws; `start == end` is a
   * valid empty range.
   */
  public async *readMessages(
    args: {
      topics?: readonly string[];
      /** Only messages with `logTime >= startingAt` are returned. */
      startingAt?: bigint;
      /** Only messages with `logTime > startingAfter` are returned. */
      startingAfter?: bigint;
      /** Only messages with `logTime <= endingAt` are returned. */
      endingAt?: bigint;
      /** Only messages with `logTime < endingBefore` are returned. */
      endingBefore?: bigint;
      reverse?: boolean;
      validateCrcs?: boolean;
      readOptions?: TReadOptions;
    } = {},
  ): AsyncGenerator<TypedMcapRecords["Message"], void, void> {
    const { topics, reverse = false, validateCrcs, readOptions } = args;
    const { startingAt, endingAt } = resolveInclusiveTimeRange(
      args,
      this.#messageStartTime,
      this.#messageEndTime,
    );

    if (startingAt == undefined || endingAt == undefined) {
      return;
    }

    let relevantChannels: Set<number> | undefined;
    if (topics) {
      relevantChannels = new Set();
      for (const channel of this.channelsById.values()) {
        if (topics.includes(channel.topic)) {
          relevantChannels.add(channel.id);
        }
      }
    }

    const chunkCursors = new Heap<ChunkCursor>((a, b) => a.compare(b));
    let chunksOrdered = true;
    let prevChunkEndTime: bigint | undefined;
    const chunksInRange: ChunkIndex[] = [];
    for (const chunkIndex of this.chunkIndexes) {
      if (chunkIndex.messageStartTime <= endingAt && chunkIndex.messageEndTime >= startingAt) {
        chunksInRange.push(chunkIndex);
        chunkCursors.push(
          new ChunkCursor({
            chunkIndex,
            relevantChannels,
            startingAt,
            endingAt,
            reverse,
          }),
        );
        if (chunksOrdered && prevChunkEndTime != undefined) {
          chunksOrdered = chunkIndex.messageStartTime >= prevChunkEndTime;
        }
        prevChunkEndTime = chunkIndex.messageEndTime;
      }
    }

    const readAhead = this.#chunkCache?.readAhead;
    const plan = readAhead ? readAheadPlan(chunksInRange, reverse, relevantChannels) : undefined;

    // Holds the decompressed chunk data for "active" chunks. Items are added below when a chunk
    // cursor becomes active (i.e. when we first need to access messages from the chunk) and removed
    // when the cursor is removed from the heap.
    const chunkViewCache = new Map<bigint, DataView>();
    const chunkReader = new McapByteReader(new DataView(new ArrayBuffer(0)));
    for (let cursor; (cursor = chunkCursors.peek()); ) {
      if (!cursor.hasMessageIndexes()) {
        // If we encounter a chunk whose message indexes have not been loaded yet, load them and re-organize the heap.
        await cursor.loadMessageIndexes(this.#readable, readOptions);
        if (cursor.hasMoreMessages()) {
          chunkCursors.replace(cursor);
        } else {
          chunkCursors.pop();
        }
        continue;
      }

      let chunkView = chunkViewCache.get(cursor.chunkIndex.chunkStartOffset);
      if (!chunkView) {
        const options = { validateCrcs: validateCrcs ?? true, readOptions };
        chunkView = await this.#loadChunkData(cursor.chunkIndex, options);
        // Only now, so loading ahead doesn't delay this chunk (the first message after a seek)
        if (readAhead && plan) {
          this.#loadAhead(readAhead, plan, cursor.chunkIndex, options);
        }
        chunkViewCache.set(cursor.chunkIndex.chunkStartOffset, chunkView);
      }

      const [logTime, offset] = cursor.popMessage();
      if (offset >= BigInt(chunkView.byteLength)) {
        throw this.#errorWithLibrary(
          `Message offset beyond chunk bounds (log time ${logTime}, offset ${offset}, chunk data length ${chunkView.byteLength}) in chunk at offset ${cursor.chunkIndex.chunkStartOffset}`,
        );
      }
      chunkReader.reset(chunkView, Number(offset));
      const record = parseRecord(chunkReader, validateCrcs ?? true);
      if (!record) {
        throw this.#errorWithLibrary(
          `Unable to parse record at offset ${offset} in chunk at offset ${cursor.chunkIndex.chunkStartOffset}`,
        );
      }
      if (record.type !== "Message") {
        throw this.#errorWithLibrary(
          `Unexpected record type ${record.type} in message index (time ${logTime}, offset ${offset} in chunk at offset ${cursor.chunkIndex.chunkStartOffset})`,
        );
      }
      if (record.logTime !== logTime) {
        throw this.#errorWithLibrary(
          `Message log time ${record.logTime} did not match message index entry (${logTime} at offset ${offset} in chunk at offset ${cursor.chunkIndex.chunkStartOffset})`,
        );
      }
      yield record;

      if (cursor.hasMoreMessages()) {
        // There is no need to reorganize the heap when chunks are ordered and not overlapping.
        // We can simply keep on reading messages from the current chunk.
        if (!chunksOrdered) {
          chunkCursors.replace(cursor);
        }
      } else {
        chunkCursors.pop();
        chunkViewCache.delete(cursor.chunkIndex.chunkStartOffset);
      }
    }
  }

  public async *readMetadata(
    args: { name?: string; readOptions?: TReadOptions } = {},
  ): AsyncGenerator<TypedMcapRecords["Metadata"], void, void> {
    const { name, readOptions } = args;

    for (const metadataIndex of this.metadataIndexes) {
      if (name != undefined && metadataIndex.name !== name) {
        continue;
      }
      const metadataData = await this.#readable.read(
        metadataIndex.offset,
        metadataIndex.length,
        readOptions,
      );
      const metadataReader = new McapByteReader(
        new DataView(metadataData.buffer, metadataData.byteOffset, metadataData.byteLength),
      );
      const metadataRecord = parseRecord(metadataReader, false);
      if (metadataRecord?.type !== "Metadata") {
        throw this.#errorWithLibrary(
          `Metadata data at offset ${
            metadataIndex.offset
          } does not point to metadata record (found ${String(metadataRecord?.type)})`,
        );
      }
      yield metadataRecord;
    }
  }

  /**
   * Read attachments from the file, optionally filtering by name, media
   * type, and log time. Provide at most one lower bound (`startingAt` or
   * `startingAfter`) and one upper bound (`endingAt` or `endingBefore`). The
   * bounds resolve to a half-open range `[start, end)`. `start > end` throws;
   * `start == end` is a valid empty range.
   */
  public async *readAttachments(
    args: {
      name?: string;
      mediaType?: string;
      /** Only attachments with `logTime >= startingAt` are returned. */
      startingAt?: bigint;
      /** Only attachments with `logTime > startingAfter` are returned. */
      startingAfter?: bigint;
      /** Only attachments with `logTime <= endingAt` are returned. */
      endingAt?: bigint;
      /** Only attachments with `logTime < endingBefore` are returned. */
      endingBefore?: bigint;
      validateCrcs?: boolean;
      readOptions?: TReadOptions;
    } = {},
  ): AsyncGenerator<TypedMcapRecords["Attachment"], void, void> {
    const { name, mediaType, validateCrcs, readOptions } = args;
    const { startingAt, endingAt } = resolveInclusiveTimeRange(
      args,
      this.#attachmentStartTime,
      this.#attachmentEndTime,
    );

    if (startingAt == undefined || endingAt == undefined) {
      return;
    }

    for (const attachmentIndex of this.attachmentIndexes) {
      if (name != undefined && attachmentIndex.name !== name) {
        continue;
      }
      if (mediaType != undefined && attachmentIndex.mediaType !== mediaType) {
        continue;
      }
      if (attachmentIndex.logTime > endingAt || attachmentIndex.logTime < startingAt) {
        continue;
      }
      const attachmentData = await this.#readable.read(
        attachmentIndex.offset,
        attachmentIndex.length,
        readOptions,
      );
      const attachmentReader = new McapByteReader(
        new DataView(attachmentData.buffer, attachmentData.byteOffset, attachmentData.byteLength),
      );
      const attachmentRecord = parseRecord(attachmentReader, validateCrcs ?? true);
      if (attachmentRecord?.type !== "Attachment") {
        throw this.#errorWithLibrary(
          `Attachment data at offset ${
            attachmentIndex.offset
          } does not point to attachment record (found ${String(attachmentRecord?.type)})`,
        );
      }
      yield attachmentRecord;
    }
  }

  async #loadChunkData(
    chunkIndex: ChunkIndex,
    options: { validateCrcs: boolean; readOptions?: TReadOptions },
  ): Promise<DataView> {
    const cached = this.#chunkCache?.get(chunkIndex.chunkStartOffset);
    if (cached && !(options.validateCrcs && uncheckedChunks.has(cached))) {
      return cached;
    }
    const loading = this.#loadingAhead.get(chunkIndex.chunkStartOffset);
    if (loading) {
      const ahead = await loading;
      if (ahead && !(options.validateCrcs && uncheckedChunks.has(ahead))) {
        return ahead;
      }
    }
    const view = await this.#loadChunkDataUncached(chunkIndex, options);
    if (!options.validateCrcs) {
      uncheckedChunks.add(view);
    }
    this.#chunkCache?.set(chunkIndex.chunkStartOffset, view);
    return view;
  }

  /** Starts loading the chunks after `current` in `plan` that aren't cached or loading yet */
  #loadAhead(
    readAhead: ChunkReadAhead,
    plan: ReadAheadPlan,
    current: ChunkIndex,
    options: { validateCrcs: boolean; readOptions?: TReadOptions },
  ): void {
    const position = plan.position.get(current.chunkStartOffset);
    if (position == undefined) {
      return;
    }
    const last = Math.min(position + readAhead.chunks, plan.chunks.length - 1);
    for (let i = position + 1; i <= last; i++) {
      const chunkIndex = plan.chunks[i]!;
      const offset = chunkIndex.chunkStartOffset;
      if (this.#loadingAhead.has(offset) || this.#chunkCache?.get(offset)) {
        continue;
      }
      const bytes = Number(chunkIndex.chunkLength + chunkIndex.uncompressedSize);
      if (!readAhead.reserve(bytes)) {
        return;
      }
      const loading = this.#loadChunkDataAhead(readAhead, chunkIndex, options)
        // A failed load ahead isn't reported: the read loads that chunk inline and reports it then
        .catch(() => undefined)
        .finally(() => {
          readAhead.release(bytes);
          this.#loadingAhead.delete(offset);
        });
      this.#loadingAhead.set(offset, loading);
    }
  }

  async #loadChunkDataAhead(
    readAhead: ChunkReadAhead,
    chunkIndex: ChunkIndex,
    options: { validateCrcs: boolean; readOptions?: TReadOptions },
  ): Promise<DataView> {
    const chunk = await this.#readChunk(chunkIndex, options);
    let buffer = chunk.records;
    if (chunk.compression !== "" && buffer.byteLength > 0) {
      if (!this.#decompressHandlers?.[chunk.compression]) {
        throw this.#errorWithLibrary(`Unsupported compression ${chunk.compression}`);
      }
      buffer = await readAhead.decompress(
        chunk.compression,
        buffer.slice(),
        chunk.uncompressedSize,
      );
    }
    const view = this.#checkedView(chunk, buffer, options);
    if (!options.validateCrcs) {
      uncheckedChunks.add(view);
    }
    this.#chunkCache?.set(chunkIndex.chunkStartOffset, view);
    return view;
  }

  async #loadChunkDataUncached(
    chunkIndex: ChunkIndex,
    options: { validateCrcs: boolean; readOptions?: TReadOptions },
  ): Promise<DataView> {
    const chunk = await this.#readChunk(chunkIndex, options);
    let buffer = chunk.records;
    if (chunk.compression !== "" && buffer.byteLength > 0) {
      const decompress = this.#decompressHandlers?.[chunk.compression];
      if (!decompress) {
        throw this.#errorWithLibrary(`Unsupported compression ${chunk.compression}`);
      }
      buffer = decompress(buffer, chunk.uncompressedSize);
    }
    return this.#checkedView(chunk, buffer, options);
  }

  async #readChunk(
    chunkIndex: ChunkIndex,
    options: { validateCrcs: boolean; readOptions?: TReadOptions },
  ): Promise<TypedMcapRecords["Chunk"]> {
    const chunkData = await this.#readable.read(
      chunkIndex.chunkStartOffset,
      chunkIndex.chunkLength,
      options.readOptions,
    );
    const chunkReader = new McapByteReader(
      new DataView(chunkData.buffer, chunkData.byteOffset, chunkData.byteLength),
    );
    const chunkRecord = parseRecord(chunkReader, options.validateCrcs);
    if (chunkRecord?.type !== "Chunk") {
      throw this.#errorWithLibrary(
        `Chunk start offset ${
          chunkIndex.chunkStartOffset
        } does not point to chunk record (found ${String(chunkRecord?.type)})`,
      );
    }

    return chunkRecord;
  }

  /** The decompressed records as a DataView, after checking their CRC if asked to */
  #checkedView(
    chunk: TypedMcapRecords["Chunk"],
    buffer: Uint8Array,
    options: { validateCrcs: boolean },
  ): DataView {
    if (chunk.uncompressedCrc !== 0 && options.validateCrcs) {
      const chunkCrc = crc32(buffer);
      if (chunkCrc !== chunk.uncompressedCrc) {
        throw this.#errorWithLibrary(
          `Incorrect chunk CRC ${chunkCrc} (expected ${chunk.uncompressedCrc})`,
        );
      }
    }

    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
}

type ReadAheadPlan = {
  /** The chunks a read will load, in the order it reaches them */
  chunks: ChunkIndex[];
  position: Map<bigint, number>;
};

/**
 * The chunks in a read's time range that hold a message on a channel it wants, ordered by when the
 * read reaches them: by first message time (last message time, newest first, for a reverse read).
 */
function readAheadPlan(
  chunksInRange: readonly ChunkIndex[],
  reverse: boolean,
  relevantChannels: Set<number> | undefined,
): ReadAheadPlan {
  const chunks: ChunkIndex[] = [];
  for (const chunkIndex of chunksInRange) {
    if (relevantChannels) {
      let relevant = false;
      for (const channelId of chunkIndex.messageIndexOffsets.keys()) {
        if (relevantChannels.has(channelId)) {
          relevant = true;
          break;
        }
      }
      if (!relevant) {
        continue;
      }
    }
    chunks.push(chunkIndex);
  }
  chunks.sort(
    reverse
      ? (a, b) => compareBigInt(b.messageEndTime, a.messageEndTime)
      : (a, b) => compareBigInt(a.messageStartTime, b.messageStartTime),
  );
  return { chunks, position: new Map(chunks.map((chunk, i) => [chunk.chunkStartOffset, i])) };
}

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Resolve the time bounds to the inclusive `startingAt`/`endingAt` pair used internally, throwing
 * on conflicting bounds or a strictly crossed range.
 */
function resolveInclusiveTimeRange(
  args: {
    startingAt?: bigint;
    startingAfter?: bigint;
    endingAt?: bigint;
    endingBefore?: bigint;
  },
  defaultStart: bigint | undefined,
  defaultEnd: bigint | undefined,
): { startingAt: bigint | undefined; endingAt: bigint | undefined } {
  if (args.startingAt != undefined && args.startingAfter != undefined) {
    throw new Error("Provide at most one of startingAt, startingAfter");
  }
  if (args.endingAt != undefined && args.endingBefore != undefined) {
    throw new Error("Provide at most one of endingAt, endingBefore");
  }
  const startingAt = args.startingAfter != undefined ? args.startingAfter + 1n : args.startingAt;
  const endingAt = args.endingBefore != undefined ? args.endingBefore - 1n : args.endingAt;
  // Only the provided bounds are checked for crossing: the defaults come from the file's own
  // time range, and a bound beyond it is a valid empty query. So is an empty range. BigInt
  // arithmetic makes 2^64 representable, so startingAfter at 2^64 - 1 is an ordinary bound:
  // empty with no upper bound or endingAt 2^64 - 1, crossed with any other.
  if (startingAt != undefined && endingAt != undefined && startingAt > endingAt + 1n) {
    throw new Error("end time cannot come before start time");
  }
  return { startingAt: startingAt ?? defaultStart, endingAt: endingAt ?? defaultEnd };
}
