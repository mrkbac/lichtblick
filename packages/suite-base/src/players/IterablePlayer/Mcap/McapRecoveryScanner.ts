// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { crc32 } from "@foxglove/crc";
import {
  MCAP_MAGIC,
  McapByteReader,
  type McapIndexedReader,
  McapRecordBuilder,
  McapTypes,
  Opcode,
  isKnownOpcode,
  parseRecord,
} from "@mcap/core";

import { type ChunkCache, openCachedMcapReader } from "@lichtblick/mcap-support";
import type { PlayerAlert } from "@lichtblick/suite-base/players/types";

const RECORD_PREFIX_LENGTH = 9n; // opcode + content length
const READ_WINDOW_BYTES = 8n * 1024n * 1024n;
const SNAPSHOT_VERSION = 2;
// Where the readers built from the index (see #readable) find the message indexes and the summary:
// far past any real file offset, so neither moves as the file and its index grow. Chunk i's message
// indexes are at LIVE_INDEX_AT + i * INDEX_STRIDE; they aren't stored but rebuilt from the chunk
// when a read needs them, so memory doesn't grow with the message count.
const LIVE_INDEX_AT = 1n << 62n;
const INDEX_STRIDE = 1n << 31n;
const LIVE_SUMMARY_AT = 1n << 63n;
// MessageIndex record: opcode, record length, channel id, records length, then 16 B per message
const MESSAGE_INDEX_BASE_BYTES = 15n;
// Message record fields before the data: channel id, sequence, log time, publish time
const MESSAGE_HEADER_BYTES = 22;
// Where a message record's log time is: after opcode, length, channel id and sequence
const LOG_TIME_OFFSET = 15;

/** A reader on a growing index; `grow()` adds what was scanned since and returns the new chunks */
export type LiveReader = {
  reader: McapIndexedReader;
  grow: () => readonly McapTypes.ChunkIndex[];
};

// The index fields McapIndexedReader builds once in Initialize; readMessages reads them per call
type MutableIndex = {
  chunkIndexes: McapTypes.ChunkIndex[];
  attachmentIndexes: McapTypes.AttachmentIndex[];
  metadataIndexes: McapTypes.MetadataIndex[];
  channelsById: Map<number, McapTypes.Channel>;
  schemasById: Map<number, McapTypes.Schema>;
  statistics: McapTypes.Statistics | undefined;
};

type SnapshotHeader = {
  version: number;
  offset: string;
  complete: boolean;
  chunkCount: number;
  corruptRecords: number;
  unchunkedMessageCount: number;
};

/**
 * Recovers a damaged MCAP (no footer or summary, truncated last record, corrupt chunks, garbage at
 * the end) by walking its records forward from the start. Every complete record is kept, chunks
 * that fail to decompress or fail their CRC are skipped, and an index is built in memory.
 * `toReadable()` then presents the recovered bytes plus a freshly written summary and footer, so
 * the regular `McapIndexedReader` can seek in it.
 *
 * `scan()` resumes where the previous call stopped (the end of the last complete record), so a
 * growing file can be followed by calling it again.
 */
export class McapRecoveryScanner {
  /** End of the last complete record: the next scan starts here */
  public offset = 0n;
  /** Reached the end of the data section (DataEnd or Footer) */
  public complete = false;
  public chunkCount = 0;
  public corruptRecords = 0;
  public messageCount = 0n;
  /** Messages outside chunks; the in-memory index only covers chunked messages */
  public unchunkedMessageCount = 0;
  /** Bytes after the last complete record that could not be read */
  public unreadableBytes = 0n;

  #decompressHandlers: McapTypes.DecompressHandlers;
  #schemas = new Map<number, McapTypes.Schema>();
  #channels = new Map<number, McapTypes.Channel>();
  // Only the chunk-level index is kept: offset, length, time range and channels per chunk. Its
  // message index offsets point at LIVE_INDEX_AT + i * INDEX_STRIDE (see #readable).
  #chunkIndexes: McapTypes.ChunkIndex[] = [];
  // Chunks being rebuilt (see #readable) by start offset, so readers that miss the cache at the
  // same time share one rebuild
  #rebuilding = new Map<bigint, Promise<DataView>>();
  #attachmentIndexes: McapTypes.AttachmentIndex[] = [];
  #metadataIndexes: McapTypes.MetadataIndex[] = [];
  #channelMessageCounts = new Map<number, bigint>();
  #messageStartTime?: bigint;
  #messageEndTime?: bigint;
  #readBuffer?: { offset: bigint; bytes: Uint8Array };
  // Where the current scan step stops: read windows end there, so short steps read no further
  #stopAt = 0n;

  public constructor(decompressHandlers: McapTypes.DecompressHandlers) {
    this.#decompressHandlers = decompressHandlers;
  }

  public recoveredChunkCount(): number {
    return this.#chunkIndexes.length;
  }

  /** Log time range (ns) of the chunks indexed in [from, to), in O(to - from) */
  public chunkTimeRange(from: number, to: number): { start: bigint; end: bigint } | undefined {
    let range: { start: bigint; end: bigint } | undefined;
    for (let i = from; i < to; i++) {
      const { messageStartTime: start, messageEndTime: end } = this.#chunkIndexes[i]!;
      range = {
        start: range && range.start < start ? range.start : start,
        end: range && range.end > end ? range.end : end,
      };
    }
    return range;
  }

  /**
   * Everything needed to restore this scanner without scanning again: the counters, then the
   * same summary and footer `toReadable()` serves.
   */
  public toSnapshot(): Uint8Array {
    const tail = this.#buildSummary(LIVE_SUMMARY_AT);
    const header = new TextEncoder().encode(
      JSON.stringify({
        version: SNAPSHOT_VERSION,
        offset: String(this.offset),
        complete: this.complete,
        chunkCount: this.chunkCount,
        corruptRecords: this.corruptRecords,
        unchunkedMessageCount: this.unchunkedMessageCount,
      } satisfies SnapshotHeader),
    );
    const out = new Uint8Array(4 + header.byteLength + tail.byteLength);
    new DataView(out.buffer).setUint32(0, header.byteLength, true);
    out.set(header, 4);
    out.set(tail, 4 + header.byteLength);
    return out;
  }

  /** The inverse of `toSnapshot()`; throws on anything it doesn't recognize */
  public static fromSnapshot(
    snapshot: Uint8Array,
    decompressHandlers: McapTypes.DecompressHandlers,
  ): McapRecoveryScanner {
    const view = new DataView(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength);
    const headerLength = view.getUint32(0, true);
    const header = JSON.parse(
      new TextDecoder().decode(snapshot.subarray(4, 4 + headerLength)),
    ) as SnapshotHeader;
    if (header.version !== SNAPSHOT_VERSION) {
      throw new Error("Unknown snapshot version");
    }
    const scanner = new McapRecoveryScanner(decompressHandlers);
    scanner.offset = BigInt(header.offset);
    scanner.complete = header.complete;
    scanner.chunkCount = header.chunkCount;
    scanner.corruptRecords = header.corruptRecords;
    scanner.unchunkedMessageCount = header.unchunkedMessageCount;

    const summary = reader(snapshot.slice(4 + headerLength));
    for (;;) {
      const record = parseRecord(summary, true);
      if (!record) {
        throw new Error("Snapshot ends before its footer");
      }
      if (record.type === "Footer") {
        break;
      }
      switch (record.type) {
        case "Schema":
          scanner.#schemas.set(record.id, record);
          break;
        case "Channel":
          scanner.#channels.set(record.id, record);
          break;
        case "ChunkIndex":
          scanner.#chunkIndexes.push(record);
          break;
        case "AttachmentIndex":
          scanner.#attachmentIndexes.push(record);
          break;
        case "MetadataIndex":
          scanner.#metadataIndexes.push(record);
          break;
        case "Statistics":
          scanner.messageCount = record.messageCount;
          scanner.#channelMessageCounts = new Map(record.channelMessageCounts);
          if (scanner.#chunkIndexes.length > 0) {
            scanner.#messageStartTime = record.messageStartTime;
            scanner.#messageEndTime = record.messageEndTime;
          }
          break;
        default:
          break;
      }
    }
    return scanner;
  }

  /**
   * Scans about `maxBytes` further (everything by default). Returns true if it stopped there with
   * more to read, false once it reached the end of the readable records.
   */
  public async scan(readable: McapTypes.IReadable, maxBytes?: bigint): Promise<boolean> {
    this.#readBuffer = undefined;
    this.unreadableBytes = 0n;
    const size = await readable.size();
    if (this.offset === 0n) {
      this.offset = await this.#readHeader(readable, size);
    }
    const stopAt = maxBytes == undefined ? size : this.offset + maxBytes;
    this.#stopAt = stopAt;
    while (!this.complete && this.offset + RECORD_PREFIX_LENGTH <= size) {
      if (this.offset >= stopAt) {
        this.#readBuffer = undefined;
        return true;
      }
      const prefix = await this.#read(readable, size, this.offset, RECORD_PREFIX_LENGTH);
      const opcode = prefix[0]!;
      const recordEnd =
        this.offset +
        RECORD_PREFIX_LENGTH +
        new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getBigUint64(1, true);
      // A truncated last record, or garbage whose length runs past the end of the file
      if (recordEnd > size) {
        break;
      }
      if (opcode === Opcode.DATA_END || opcode === Opcode.FOOTER) {
        this.complete = true;
        break;
      }
      // Not a record (opcodes 0x80+ are private records and fine to skip): garbage, stop here.
      // ponytail: no resync after garbage; scanning for the next plausible record header would
      // recover data behind a corrupt record length.
      if (opcode < 0x80 && !isKnownOpcode(opcode)) {
        break;
      }
      if (
        opcode === Opcode.CHUNK ||
        opcode === Opcode.MESSAGE ||
        opcode === Opcode.SCHEMA ||
        opcode === Opcode.CHANNEL ||
        opcode === Opcode.ATTACHMENT ||
        opcode === Opcode.METADATA
      ) {
        const bytes = await this.#read(readable, size, this.offset, recordEnd - this.offset);
        try {
          this.#addRecord(bytes, this.offset);
        } catch {
          this.corruptRecords++;
        }
      }
      this.offset = recordEnd;
    }
    this.unreadableBytes = this.complete ? 0n : size - this.offset;
    this.#readBuffer = undefined;
    return false;
  }

  /**
   * The records scanned so far plus message indexes, a summary and a footer built from the
   * in-memory index, at fixed offsets past the file (see LIVE_INDEX_AT). Safe to call mid-scan: it
   * is a snapshot that later scanning doesn't change.
   */
  public toReadable(base: McapTypes.IReadable, cache: ChunkCache): McapTypes.IReadable {
    return this.#readable(base, this.#buildSummary(LIVE_SUMMARY_AT), cache);
  }

  /**
   * `base` with the message indexes and `summary` past its end. Message indexes are rebuilt from
   * their chunk on demand, and both go into `cache`, where the reader (given the same cache) finds
   * the chunk when it reads its messages right after.
   */
  #readable(
    base: McapTypes.IReadable,
    summary: Uint8Array,
    cache: ChunkCache,
  ): McapTypes.IReadable {
    return {
      size: async () => LIVE_SUMMARY_AT + BigInt(summary.byteLength),
      read: async (offset, length) => {
        if (offset >= LIVE_SUMMARY_AT) {
          const start = Number(offset - LIVE_SUMMARY_AT);
          return summary.subarray(start, start + Number(length));
        }
        if (offset >= LIVE_INDEX_AT) {
          // A read stays within one chunk's message indexes (see ChunkCursor.loadMessageIndexes)
          const i = (offset - LIVE_INDEX_AT) / INDEX_STRIDE;
          const chunk = this.#chunkIndexes[Number(i)]!;
          const key = chunk.chunkStartOffset;
          let messageIndexes = cache.getMessageIndexes(key);
          if (!messageIndexes) {
            let rebuild = this.#rebuilding.get(key);
            if (!rebuild) {
              rebuild = this.#rebuildChunk(base, chunk)
                .then(({ records, messageIndexes: rebuilt }) => {
                  cache.set(key, records);
                  cache.setMessageIndexes(key, rebuilt);
                  return rebuilt;
                })
                .finally(() => {
                  this.#rebuilding.delete(key);
                });
              this.#rebuilding.set(key, rebuild);
            }
            messageIndexes = await rebuild;
          }
          const start = Number(offset - LIVE_INDEX_AT - i * INDEX_STRIDE);
          return new Uint8Array(
            messageIndexes.buffer,
            messageIndexes.byteOffset + start,
            Number(length),
          );
        }
        return await base.read(offset, length);
      },
    };
  }

  /** Reads and decompresses the chunk and writes its message indexes as #addChunk laid them out */
  async #rebuildChunk(
    base: McapTypes.IReadable,
    chunkIndex: McapTypes.ChunkIndex,
  ): Promise<{ records: DataView; messageIndexes: DataView }> {
    const changed = () =>
      new Error(`Chunk at offset ${chunkIndex.chunkStartOffset} changed since it was indexed`);
    // The chunk header is read in place: parseRecord would copy the records
    const bytes = await base.read(chunkIndex.chunkStartOffset, chunkIndex.chunkLength);
    const chunkView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const compressionLength = bytes.byteLength >= 41 ? chunkView.getUint32(37, true) : -1;
    const recordsAt = 41 + compressionLength + 8;
    if (
      compressionLength < 0 ||
      chunkView.getUint8(0) !== Opcode.CHUNK ||
      recordsAt > bytes.byteLength ||
      BigInt(recordsAt) + chunkView.getBigUint64(recordsAt - 8, true) !== chunkIndex.chunkLength
    ) {
      throw changed();
    }
    const compression = new TextDecoder().decode(bytes.subarray(41, 41 + compressionLength));
    const compressed = bytes.subarray(recordsAt);
    const records =
      compression === ""
        ? compressed
        : this.#decompress(compression, compressed, chunkView.getBigUint64(25, true));
    // Each channel's MessageIndex record where the chunk index points, filled in one walk
    const messageIndexes = new Uint8Array(Number(chunkIndex.messageIndexLength));
    const view = new DataView(messageIndexes.buffer);
    const cursors = new Map<number, { at: number; end: number }>();
    const offsets = [...chunkIndex.messageIndexOffsets];
    const indexAt = offsets[0]?.[1] ?? 0n;
    offsets.forEach(([channelId, offset], i) => {
      const at = Number(offset - indexAt);
      const end = i + 1 < offsets.length ? Number(offsets[i + 1]![1] - indexAt) : view.byteLength;
      view.setUint8(at, Opcode.MESSAGE_INDEX);
      view.setBigUint64(at + 1, BigInt(end - at - 9), true);
      view.setUint16(at + 9, channelId, true);
      view.setUint32(at + 11, end - at - Number(MESSAGE_INDEX_BASE_BYTES), true);
      cursors.set(channelId, { at: at + Number(MESSAGE_INDEX_BASE_BYTES), end });
    });
    const recordsView = new DataView(records.buffer, records.byteOffset, records.byteLength);
    walkChunk(records, (channelId, offset) => {
      const cursor = cursors.get(channelId);
      if (!cursor || cursor.at >= cursor.end) {
        throw changed();
      }
      // Copied as 32-bit words: no BigInt per message. Offsets in a chunk fit in 32 bits.
      const logTimeAt = offset + LOG_TIME_OFFSET;
      view.setUint32(cursor.at, recordsView.getUint32(logTimeAt, true), true);
      view.setUint32(cursor.at + 4, recordsView.getUint32(logTimeAt + 4, true), true);
      view.setUint32(cursor.at + 8, offset, true);
      cursor.at += 16;
    });
    for (const cursor of cursors.values()) {
      if (cursor.at !== cursor.end) {
        throw changed();
      }
    }

    return { records: recordsView, messageIndexes: view };
  }

  /**
   * An indexed reader on the index so far that keeps up with later scans without being rebuilt:
   * `grow()` appends what was indexed since (chunks, channels, schemas, attachments, metadata,
   * statistics) and returns the new chunk indexes. Its cost is O(what is new), so
   * following a huge or growing file costs the same per update however much is indexed already.
   */
  public async openLiveReader(
    base: McapTypes.IReadable,
    decompressHandlers: McapTypes.DecompressHandlers,
    cache: ChunkCache,
  ): Promise<LiveReader> {
    // What the summary holds; counted now, since scanning may go on while Initialize awaits
    let chunks = this.#chunkIndexes.length;
    let attachments = this.#attachmentIndexes.length;
    let metadata = this.#metadataIndexes.length;
    const indexedReader = await openCachedMcapReader({
      decompressHandlers,
      readable: this.#readable(base, this.#buildSummary(LIVE_SUMMARY_AT), cache),
      chunkCache: cache,
    });
    // ponytail: McapIndexedReader has no API to append to its index, so this writes to the fields
    // Initialize built (readMessages reads them on every call). Its private time range stays at
    // what was indexed at open; it is only a default for reads without bounds, so pass bounds.
    const index = indexedReader as unknown as MutableIndex;
    const grow = (): McapTypes.ChunkIndex[] => {
      const added = this.#chunkIndexes.slice(chunks);
      // Loops, not push(...): a spread of a long list overflows the call stack
      for (const chunk of added) {
        index.chunkIndexes.push(chunk);
      }
      chunks = this.#chunkIndexes.length;
      for (; attachments < this.#attachmentIndexes.length; attachments++) {
        index.attachmentIndexes.push(this.#attachmentIndexes[attachments]!);
      }
      for (; metadata < this.#metadataIndexes.length; metadata++) {
        index.metadataIndexes.push(this.#metadataIndexes[metadata]!);
      }
      // Records can only add or replace ids, never remove one, so a size check finds new ones
      if (index.channelsById.size !== this.#channels.size) {
        index.channelsById = new Map(this.#channels);
      }
      if (index.schemasById.size !== this.#schemas.size) {
        index.schemasById = new Map(this.#schemas);
      }
      index.statistics = this.#statistics();
      return added;
    };
    return { reader: indexedReader, grow };
  }

  /** Whether the scan had to drop anything (corrupt records, unreadable bytes, unchunked messages) */
  public hasLosses(): boolean {
    return this.#losses().length > 0;
  }

  /** What was recovered and lost, for the user */
  public toAlert(): PlayerAlert {
    const lost = this.#losses();
    const recovered = this.#recovered();
    if (lost.length === 0) {
      return this.complete
        ? {
            severity: "info",
            message: "This file has no index; it was rebuilt in memory.",
            tip: `${recovered}.`,
          }
        : {
            severity: "warn",
            message: "This file was not closed properly (no footer); recovered all of its records.",
            tip: `${recovered}.`,
          };
    }
    return this.#damagedAlert(lost);
  }

  /**
   * For a file still being written: what was lost, if anything, ignoring the cut-off end (the part
   * not written yet).
   */
  public toLiveAlerts(): PlayerAlert[] {
    const lost = this.#losses({ live: true });
    return lost.length > 0 ? [this.#damagedAlert(lost)] : [];
  }

  #recovered(): string {
    return this.#chunkIndexes.length > 0
      ? `Recovered ${this.messageCount} message(s) from ${this.#chunkIndexes.length} chunk(s)`
      : `Recovered ${this.unchunkedMessageCount} message(s)`;
  }

  #damagedAlert(lost: string[]): PlayerAlert {
    return {
      severity: "warn",
      message: "This file is damaged; showing what could be recovered.",
      tip: `${this.#recovered()}; ${lost.join("; ")}.`,
    };
  }

  #losses({ live = false }: { live?: boolean } = {}): string[] {
    const lost: string[] = [];
    if (this.corruptRecords > 0) {
      lost.push(
        `${this.corruptRecords} corrupt record(s) (e.g. chunks with a bad CRC) were skipped`,
      );
    }
    if (this.unreadableBytes > 0n && !live) {
      lost.push(
        `the last ${formatBytes(this.unreadableBytes)} could not be read (cut off or not MCAP data)`,
      );
    }
    if (this.unchunkedMessageCount > 0 && this.#chunkIndexes.length > 0) {
      lost.push(`${this.unchunkedMessageCount} message(s) outside chunks were skipped`);
    }
    return lost;
  }

  async #readHeader(readable: McapTypes.IReadable, size: bigint): Promise<bigint> {
    const magicLength = BigInt(MCAP_MAGIC.length);
    if (size < magicLength + RECORD_PREFIX_LENGTH) {
      throw new Error("File is too small to be an MCAP file");
    }
    const magic = await this.#read(readable, size, 0n, magicLength);
    if (!MCAP_MAGIC.every((byte, i) => magic[i] === byte)) {
      throw new Error("File does not start with the MCAP magic bytes");
    }
    const prefix = await this.#read(readable, size, magicLength, RECORD_PREFIX_LENGTH);
    const end =
      magicLength +
      RECORD_PREFIX_LENGTH +
      new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getBigUint64(1, true);
    if (prefix[0] !== Opcode.HEADER || end > size) {
      throw new Error("MCAP header is missing or cut off");
    }
    const record = parseRecord(
      reader(await this.#read(readable, size, magicLength, end - magicLength)),
      true,
    );
    if (record?.type !== "Header") {
      throw new Error("MCAP header is unreadable");
    }
    return end;
  }

  #addRecord(bytes: Uint8Array, offset: bigint): void {
    const record = parseRecord(reader(bytes), true);
    switch (record?.type) {
      case "Chunk":
        this.#addChunk(record, offset, BigInt(bytes.byteLength));
        break;
      case "Schema":
        this.#schemas.set(record.id, record);
        break;
      case "Channel":
        this.#channels.set(record.id, record);
        break;
      case "Message":
        this.unchunkedMessageCount++;
        break;
      case "Attachment":
        this.#attachmentIndexes.push({
          offset,
          length: BigInt(bytes.byteLength),
          logTime: record.logTime,
          createTime: record.createTime,
          dataSize: BigInt(record.data.byteLength),
          name: record.name,
          mediaType: record.mediaType,
        });
        break;
      case "Metadata":
        this.#metadataIndexes.push({ offset, length: BigInt(bytes.byteLength), name: record.name });
        break;
      default:
        throw new Error("Unreadable record");
    }
  }

  #decompress(compression: string, records: Uint8Array, uncompressedSize: bigint): Uint8Array {
    if (compression === "") {
      return records;
    }
    const decompress = this.#decompressHandlers[compression];
    if (!decompress) {
      throw new Error(`Unsupported compression ${compression}`);
    }
    return decompress(records, uncompressedSize);
  }

  #addChunk(chunk: McapTypes.Chunk, offset: bigint, length: bigint): void {
    const records = this.#decompress(chunk.compression, chunk.records, chunk.uncompressedSize);
    if (chunk.uncompressedCrc !== 0 && crc32(records) !== chunk.uncompressedCrc) {
      throw new Error("Chunk CRC mismatch");
    }

    // Parse everything before touching the index, so a chunk that fails halfway adds nothing.
    // Per channel only its message count and time range: the offsets are rebuilt when needed.
    const messagesByChannel = new Map<number, { count: number; start: bigint; end: bigint }>();
    const recordsView = new DataView(records.buffer, records.byteOffset, records.byteLength);
    const { schemas, channels } = walkChunk(records, (channelId, recordOffset) => {
      const logTime = recordsView.getBigUint64(recordOffset + LOG_TIME_OFFSET, true);
      const messages = messagesByChannel.get(channelId);
      if (!messages) {
        messagesByChannel.set(channelId, { count: 1, start: logTime, end: logTime });
        return;
      }
      messages.count++;
      messages.start = logTime < messages.start ? logTime : messages.start;
      messages.end = logTime > messages.end ? logTime : messages.end;
    });

    // Laid out as #rebuildChunk writes them: in this channel order, each record after the last
    const indexAt = LIVE_INDEX_AT + BigInt(this.#chunkIndexes.length) * INDEX_STRIDE;
    const messageIndexOffsets = new Map<number, bigint>();
    let messageIndexLength = 0n;
    for (const [channelId, { count }] of messagesByChannel) {
      messageIndexOffsets.set(channelId, indexAt + messageIndexLength);
      messageIndexLength += MESSAGE_INDEX_BASE_BYTES + 16n * BigInt(count);
    }
    if (messageIndexLength >= INDEX_STRIDE) {
      throw new Error("Too many messages in one chunk");
    }

    this.chunkCount++;
    for (const schema of schemas) {
      this.#schemas.set(schema.id, schema);
    }
    for (const channel of channels) {
      this.#channels.set(channel.id, channel);
    }
    if (messagesByChannel.size === 0) {
      return;
    }

    let start: bigint | undefined;
    let end: bigint | undefined;
    for (const [channelId, messages] of messagesByChannel) {
      start = start == undefined || messages.start < start ? messages.start : start;
      end = end == undefined || messages.end > end ? messages.end : end;
      this.#channelMessageCounts.set(
        channelId,
        (this.#channelMessageCounts.get(channelId) ?? 0n) + BigInt(messages.count),
      );
      this.messageCount += BigInt(messages.count);
    }
    this.#messageStartTime =
      this.#messageStartTime == undefined || start! < this.#messageStartTime
        ? start
        : this.#messageStartTime;
    this.#messageEndTime =
      this.#messageEndTime == undefined || end! > this.#messageEndTime ? end : this.#messageEndTime;
    this.#chunkIndexes.push({
      messageStartTime: start!,
      messageEndTime: end!,
      chunkStartOffset: offset,
      chunkLength: length,
      messageIndexOffsets,
      messageIndexLength,
      compression: chunk.compression,
      compressedSize: BigInt(chunk.records.byteLength),
      uncompressedSize: chunk.uncompressedSize,
    });
  }

  /** DataEnd, summary, footer and magic, to be placed at `at` */
  #buildSummary(at: bigint): Uint8Array {
    const builder = new McapRecordBuilder();
    builder.writeDataEnd({ dataSectionCrc: 0 });
    const summaryStart = at + BigInt(builder.length);
    for (const schema of this.#schemas.values()) {
      builder.writeSchema(schema);
    }
    for (const channel of this.#channels.values()) {
      builder.writeChannel(channel);
    }
    for (const chunkIndex of this.#chunkIndexes) {
      builder.writeChunkIndex(chunkIndex);
    }
    for (const attachmentIndex of this.#attachmentIndexes) {
      builder.writeAttachmentIndex(attachmentIndex);
    }
    for (const metadataIndex of this.#metadataIndexes) {
      builder.writeMetadataIndex(metadataIndex);
    }
    builder.writeStatistics(this.#statistics());
    builder.writeFooter({ summaryStart, summaryOffsetStart: 0n, summaryCrc: 0 });
    builder.writeMagic();
    return builder.bufferView().slice();
  }

  #statistics(): McapTypes.Statistics {
    return {
      messageCount: this.messageCount,
      schemaCount: this.#schemas.size,
      channelCount: this.#channels.size,
      attachmentCount: this.#attachmentIndexes.length,
      metadataCount: this.#metadataIndexes.length,
      chunkCount: this.#chunkIndexes.length,
      messageStartTime: this.#messageStartTime ?? 0n,
      messageEndTime: this.#messageEndTime ?? 0n,
      channelMessageCounts: new Map(this.#channelMessageCounts),
    };
  }

  /** Sequential reads go through a large buffered so small records don't each cost a read */
  async #read(
    readable: McapTypes.IReadable,
    size: bigint,
    offset: bigint,
    length: bigint,
  ): Promise<Uint8Array> {
    const buffered = this.#readBuffer;
    if (
      buffered &&
      offset >= buffered.offset &&
      offset + length <= buffered.offset + BigInt(buffered.bytes.byteLength)
    ) {
      const start = Number(offset - buffered.offset);
      return buffered.bytes.subarray(start, start + Number(length));
    }
    if (length >= READ_WINDOW_BYTES) {
      return await readable.read(offset, length);
    }
    let end = offset + READ_WINDOW_BYTES;
    end = end > size ? size : end;
    if (end > this.#stopAt) {
      end = this.#stopAt > offset + length ? this.#stopAt : offset + length;
    }
    const bytes = await readable.read(offset, end - offset);
    this.#readBuffer = { offset, bytes };
    return bytes.subarray(0, Number(length));
  }
}

/**
 * Calls `onMessage` for each message in a chunk's records, with the offset of its record in them
 * (its log time is at offset + LOG_TIME_OFFSET), and returns the schemas and channels in it.
 * Throws if the records end in the middle of one.
 */
function walkChunk(
  records: Uint8Array,
  onMessage: (channelId: number, offset: number) => void,
): { schemas: McapTypes.Schema[]; channels: McapTypes.Channel[] } {
  const schemas: McapTypes.Schema[] = [];
  const channels: McapTypes.Channel[] = [];
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  for (let offset = 0; offset < records.byteLength; ) {
    if (offset + 9 > records.byteLength) {
      throw new Error("Chunk ends in the middle of a record");
    }
    const opcode = view.getUint8(offset);
    const end = offset + 9 + Number(view.getBigUint64(offset + 1, true));
    if (end > records.byteLength) {
      throw new Error("Chunk ends in the middle of a record");
    }
    // Messages are most of the records: read their header in place, without copying their data
    if (opcode === Opcode.MESSAGE) {
      if (end - offset < 9 + MESSAGE_HEADER_BYTES) {
        throw new Error("Message record is too short");
      }
      onMessage(view.getUint16(offset + 9, true), offset);
    } else if (opcode === Opcode.SCHEMA || opcode === Opcode.CHANNEL) {
      const record = parseRecord(reader(records.subarray(offset, end)), true);
      if (record?.type === "Schema") {
        schemas.push(record);
      } else if (record?.type === "Channel") {
        channels.push(record);
      }
    }
    offset = end;
  }
  return { schemas, channels };
}

function reader(bytes: Uint8Array): McapByteReader {
  return new McapByteReader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

function formatBytes(bytes: bigint): string {
  const n = Number(bytes);
  return n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KiB`
      : `${(n / 1024 / 1024).toFixed(1)} MiB`;
}
