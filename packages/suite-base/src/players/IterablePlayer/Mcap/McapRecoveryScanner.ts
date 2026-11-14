// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { crc32 } from "@foxglove/crc";
import {
  MCAP_MAGIC,
  McapByteReader,
  McapIndexedReader,
  McapRecordBuilder,
  McapTypes,
  Opcode,
  isKnownOpcode,
  parseRecord,
} from "@mcap/core";

import type { PlayerAlert } from "@lichtblick/suite-base/players/types";

const RECORD_PREFIX_LENGTH = 9n; // opcode + content length
const READ_WINDOW_BYTES = 8n * 1024n * 1024n;
const SNAPSHOT_VERSION = 1;
// Where a live reader (see openLiveReader) finds the message indexes and the summary: far past
// any real file offset, so neither moves as the file and its index grow
const LIVE_INDEX_AT = 1n << 62n;
const LIVE_SUMMARY_AT = 1n << 63n;

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
  messageIndexLength: number;
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
  // Message indexes are appended as we go; chunk indexes point into these bytes (offsets relative
  // to their start) and get shifted when the summary is built. The buffer grows by doubling, so a
  // reader built mid-scan keeps a view of what existed then while the scan appends behind it.
  // ponytail: the whole message index stays in memory, ~16 B per message (1e8 messages ≈ 1.6 GB,
  // up to twice that while the buffer doubles, and one typed array caps it). Fixed-size pages
  // would drop the doubling; delta-encoded entries (~4 B) or an OPFS spill, read back by range
  // through the live reader's index offsets, would cut the rest. Worth it once files get there.
  #messageIndexBuffer = new Uint8Array(0);
  #messageIndexLength = 0;
  #chunkIndexes: McapTypes.ChunkIndex[] = [];
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

  /**
   * Everything needed to restore this scanner without scanning again: the counters, then the
   * same tail `toReadable()` serves (message indexes + summary + footer).
   */
  public toSnapshot(): Uint8Array {
    const tail = concat(
      this.#messageIndexes(),
      this.#buildSummary(this.offset + BigInt(this.#messageIndexLength), this.offset),
    );
    const header = new TextEncoder().encode(
      JSON.stringify({
        version: SNAPSHOT_VERSION,
        offset: String(this.offset),
        complete: this.complete,
        chunkCount: this.chunkCount,
        corruptRecords: this.corruptRecords,
        unchunkedMessageCount: this.unchunkedMessageCount,
        messageIndexLength: this.#messageIndexLength,
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

    const tail = snapshot.slice(4 + headerLength);
    scanner.#messageIndexBuffer = tail.subarray(0, header.messageIndexLength);
    scanner.#messageIndexLength = header.messageIndexLength;
    const summary = reader(tail.subarray(header.messageIndexLength));
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
          scanner.#chunkIndexes.push({
            ...record,
            messageIndexOffsets: new Map(
              [...record.messageIndexOffsets].map(([id, offset]) => [id, offset - scanner.offset]),
            ),
          });
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
   * The records scanned so far followed by message indexes, a summary and a footer built from the
   * in-memory index. Safe to call mid-scan: it is a snapshot that later scanning doesn't change.
   */
  public toReadable(base: McapTypes.IReadable): McapTypes.IReadable {
    const prefixLength = this.offset;
    const tail = [
      this.#messageIndexes(),
      this.#buildSummary(prefixLength + BigInt(this.#messageIndexLength), prefixLength),
    ];
    const size = tail.reduce((sum, part) => sum + BigInt(part.byteLength), prefixLength);
    return {
      size: async () => size,
      read: async (offset, length) => {
        const end = offset + length;
        if (end <= prefixLength) {
          return await base.read(offset, length);
        }
        const out = new Uint8Array(Number(length));
        if (offset < prefixLength) {
          out.set(await base.read(offset, prefixLength - offset));
        }
        let partStart = prefixLength;
        for (const part of tail) {
          const partEnd = partStart + BigInt(part.byteLength);
          const from = offset > partStart ? offset : partStart;
          const to = end < partEnd ? end : partEnd;
          if (from < to) {
            out.set(
              part.subarray(Number(from - partStart), Number(to - partStart)),
              Number(from - offset),
            );
          }
          partStart = partEnd;
        }
        return out;
      },
    };
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
  ): Promise<LiveReader> {
    // What the summary holds; counted now, since scanning may go on while Initialize awaits
    let chunks = this.#chunkIndexes.length;
    let attachments = this.#attachmentIndexes.length;
    let metadata = this.#metadataIndexes.length;
    const summary = this.#buildSummary(LIVE_SUMMARY_AT, LIVE_INDEX_AT);
    const indexedReader = await McapIndexedReader.Initialize({
      decompressHandlers,
      readable: {
        size: async () => LIVE_SUMMARY_AT + BigInt(summary.byteLength),
        read: async (offset, length) => {
          if (offset >= LIVE_SUMMARY_AT) {
            const start = Number(offset - LIVE_SUMMARY_AT);
            return summary.subarray(start, start + Number(length));
          }
          if (offset >= LIVE_INDEX_AT) {
            // The current buffer: it is reallocated as it grows
            const start = Number(offset - LIVE_INDEX_AT);
            return this.#messageIndexBuffer.subarray(start, start + Number(length));
          }
          return await base.read(offset, length);
        },
      },
    });
    // ponytail: McapIndexedReader has no API to append to its index, so this writes to the fields
    // Initialize built (readMessages reads them on every call). Its private time range stays at
    // what was indexed at open; it is only a default for reads without bounds, so pass bounds.
    const index = indexedReader as unknown as MutableIndex;
    const grow = (): McapTypes.ChunkIndex[] => {
      const added = this.#chunkIndexes
        .slice(chunks)
        .map((chunk) => shiftMessageIndexOffsets(chunk, LIVE_INDEX_AT));
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

  #addChunk(chunk: McapTypes.Chunk, offset: bigint, length: bigint): void {
    let records = chunk.records;
    if (chunk.compression !== "") {
      const decompress = this.#decompressHandlers[chunk.compression];
      if (!decompress) {
        throw new Error(`Unsupported compression ${chunk.compression}`);
      }
      records = decompress(chunk.records, chunk.uncompressedSize);
    }
    if (chunk.uncompressedCrc !== 0 && crc32(records) !== chunk.uncompressedCrc) {
      throw new Error("Chunk CRC mismatch");
    }

    // Parse everything before touching the index, so a chunk that fails halfway adds nothing.
    const schemas: McapTypes.Schema[] = [];
    const channels: McapTypes.Channel[] = [];
    const messagesByChannel = new Map<number, [logTime: bigint, offset: bigint][]>();
    const chunkReader = reader(records);
    while (chunkReader.bytesRemaining() > 0) {
      const recordOffset = BigInt(chunkReader.offset);
      const record = parseRecord(chunkReader, true);
      if (!record) {
        throw new Error("Chunk ends in the middle of a record");
      }
      if (record.type === "Schema") {
        schemas.push(record);
      } else if (record.type === "Channel") {
        channels.push(record);
      } else if (record.type === "Message") {
        let messages = messagesByChannel.get(record.channelId);
        if (!messages) {
          messages = [];
          messagesByChannel.set(record.channelId, messages);
        }
        messages.push([record.logTime, recordOffset]);
      }
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
    const messageIndexOffsets = new Map<number, bigint>();
    const messageIndexes = new McapRecordBuilder();
    for (const [channelId, messages] of messagesByChannel) {
      messages.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      start = start == undefined || messages[0]![0] < start ? messages[0]![0] : start;
      const last = messages[messages.length - 1]![0];
      end = end == undefined || last > end ? last : end;
      messageIndexOffsets.set(channelId, BigInt(this.#messageIndexLength + messageIndexes.length));
      messageIndexes.writeMessageIndex({ channelId, records: messages });
      this.#channelMessageCounts.set(
        channelId,
        (this.#channelMessageCounts.get(channelId) ?? 0n) + BigInt(messages.length),
      );
      this.messageCount += BigInt(messages.length);
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
      messageIndexLength: BigInt(messageIndexes.length),
      compression: chunk.compression,
      compressedSize: BigInt(chunk.records.byteLength),
      uncompressedSize: chunk.uncompressedSize,
    });
    const bytes = messageIndexes.bufferView();
    const needed = this.#messageIndexLength + bytes.byteLength;
    if (needed > this.#messageIndexBuffer.byteLength) {
      const grown = new Uint8Array(Math.max(needed, this.#messageIndexBuffer.byteLength * 2));
      grown.set(this.#messageIndexes());
      this.#messageIndexBuffer = grown;
    }
    this.#messageIndexBuffer.set(bytes, this.#messageIndexLength);
    this.#messageIndexLength = needed;
  }

  #messageIndexes(): Uint8Array {
    return this.#messageIndexBuffer.subarray(0, this.#messageIndexLength);
  }

  /**
   * DataEnd, summary, footer and magic, to be placed at `at`; the message indexes are at
   * `indexesAt`.
   */
  #buildSummary(at: bigint, indexesAt: bigint): Uint8Array {
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
      builder.writeChunkIndex(shiftMessageIndexOffsets(chunkIndex, indexesAt));
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

/** The chunk index with its message index offsets (relative to the message indexes) placed at `at` */
function shiftMessageIndexOffsets(chunk: McapTypes.ChunkIndex, at: bigint): McapTypes.ChunkIndex {
  return {
    ...chunk,
    messageIndexOffsets: new Map(
      [...chunk.messageIndexOffsets].map(([id, offset]) => [id, offset + at]),
    ),
  };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a);
  out.set(b, a.byteLength);
  return out;
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
