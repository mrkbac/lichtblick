// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { crc32 } from "@foxglove/crc";
import {
  MCAP_MAGIC,
  McapByteReader,
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
  // Message indexes are written as we go; chunk indexes point into these bytes (offsets relative
  // to their start) and get shifted when the summary is built.
  #messageIndexes: Uint8Array[] = [];
  #messageIndexLength = 0;
  #chunkIndexes: McapTypes.ChunkIndex[] = [];
  #attachmentIndexes: McapTypes.AttachmentIndex[] = [];
  #metadataIndexes: McapTypes.MetadataIndex[] = [];
  #channelMessageCounts = new Map<number, bigint>();
  #messageStartTime?: bigint;
  #messageEndTime?: bigint;
  #tail?: Uint8Array;
  #readBuffer?: { offset: bigint; bytes: Uint8Array };

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
    const tail = (this.#tail ??= this.#buildTail(this.offset));
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
    scanner.#messageIndexes = [tail.subarray(0, header.messageIndexLength)];
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
    scanner.#tail = tail;
    return scanner;
  }

  public async scan(readable: McapTypes.IReadable): Promise<void> {
    this.#tail = undefined;
    this.#readBuffer = undefined;
    const size = await readable.size();
    if (this.offset === 0n) {
      this.offset = await this.#readHeader(readable, size);
    }
    while (!this.complete && this.offset + RECORD_PREFIX_LENGTH <= size) {
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
  }

  /** The recovered records followed by a summary and footer built from the in-memory index */
  public toReadable(base: McapTypes.IReadable): McapTypes.IReadable {
    const prefixLength = this.offset;
    const tail = (this.#tail ??= this.#buildTail(prefixLength));
    const tailLength = BigInt(tail.byteLength);
    return {
      size: async () => prefixLength + tailLength,
      read: async (offset, length) => {
        const end = offset + length;
        if (end <= prefixLength) {
          return await base.read(offset, length);
        }
        const fromTail = tail.slice(
          Number((offset > prefixLength ? offset : prefixLength) - prefixLength),
          Number(end - prefixLength),
        );
        if (offset >= prefixLength) {
          return fromTail;
        }
        const out = new Uint8Array(Number(length));
        out.set(await base.read(offset, prefixLength - offset));
        out.set(fromTail, Number(prefixLength - offset));
        return out;
      },
    };
  }

  /** What was lost, for the user; undefined when nothing was */
  public toAlert(): PlayerAlert | undefined {
    const lost: string[] = [];
    if (this.corruptRecords > 0) {
      lost.push(
        `${this.corruptRecords} corrupt record(s) (e.g. chunks with a bad CRC) were skipped`,
      );
    }
    if (this.unreadableBytes > 0n) {
      lost.push(
        `the last ${formatBytes(this.unreadableBytes)} could not be read (cut off or not MCAP data)`,
      );
    }
    if (this.unchunkedMessageCount > 0 && this.#chunkIndexes.length > 0) {
      lost.push(`${this.unchunkedMessageCount} message(s) outside chunks were skipped`);
    }
    const recovered =
      this.#chunkIndexes.length > 0
        ? `Recovered ${this.messageCount} message(s) from ${this.#chunkIndexes.length} chunk(s)`
        : `Recovered ${this.unchunkedMessageCount} message(s)`;
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
    return {
      severity: "warn",
      message: "This file is damaged; showing what could be recovered.",
      tip: `${recovered}; ${lost.join("; ")}.`,
    };
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
    this.#messageIndexes.push(messageIndexes.bufferView().slice());
    this.#messageIndexLength += messageIndexes.length;
  }

  #buildTail(prefixLength: bigint): Uint8Array {
    const builder = new McapRecordBuilder();
    builder.writeDataEnd({ dataSectionCrc: 0 });
    const summaryStart = prefixLength + BigInt(this.#messageIndexLength + builder.length);
    for (const schema of this.#schemas.values()) {
      builder.writeSchema(schema);
    }
    for (const channel of this.#channels.values()) {
      builder.writeChannel(channel);
    }
    for (const chunkIndex of this.#chunkIndexes) {
      builder.writeChunkIndex({
        ...chunkIndex,
        messageIndexOffsets: new Map(
          [...chunkIndex.messageIndexOffsets].map(([id, offset]) => [id, offset + prefixLength]),
        ),
      });
    }
    for (const attachmentIndex of this.#attachmentIndexes) {
      builder.writeAttachmentIndex(attachmentIndex);
    }
    for (const metadataIndex of this.#metadataIndexes) {
      builder.writeMetadataIndex(metadataIndex);
    }
    builder.writeStatistics({
      messageCount: this.messageCount,
      schemaCount: this.#schemas.size,
      channelCount: this.#channels.size,
      attachmentCount: this.#attachmentIndexes.length,
      metadataCount: this.#metadataIndexes.length,
      chunkCount: this.#chunkIndexes.length,
      messageStartTime: this.#messageStartTime ?? 0n,
      messageEndTime: this.#messageEndTime ?? 0n,
      channelMessageCounts: this.#channelMessageCounts,
    });
    builder.writeFooter({ summaryStart, summaryOffsetStart: 0n, summaryCrc: 0 });
    builder.writeMagic();

    const tail = new Uint8Array(this.#messageIndexLength + builder.length);
    let at = 0;
    for (const part of this.#messageIndexes) {
      tail.set(part, at);
      at += part.byteLength;
    }
    tail.set(builder.bufferView(), at);
    return tail;
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
    const windowLength = offset + READ_WINDOW_BYTES > size ? size - offset : READ_WINDOW_BYTES;
    const bytes = await readable.read(offset, windowLength);
    this.#readBuffer = { offset, bytes };
    return bytes.subarray(0, Number(length));
  }
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
