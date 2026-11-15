// SPDX-FileCopyrightText: Copyright (c) Foxglove Technologies Inc
// SPDX-License-Identifier: MIT

import { crc32Init, crc32Update, crc32Final, crc32 } from "@foxglove/crc";

import { ChunkBuilder } from "./ChunkBuilder.ts";
import type { IWritable } from "./IWritable.ts";
import { McapRecordBuilder } from "./McapRecordBuilder.ts";
import { Opcode } from "./constants.ts";
import type {
  Schema,
  Channel,
  Message,
  Header,
  Footer,
  Attachment,
  Chunk,
  ChunkIndex,
  AttachmentIndex,
  MetadataIndex,
  SummaryOffset,
  Metadata,
  Statistics,
} from "./types.ts";
import { LIBRARY_IDENTIFIER } from "./version.ts";

/**
 * When chunks are disabled, records are buffered and written to the writable once this many bytes
 * have accumulated, when an attachment or metadata record is added, and at end(). This keeps a
 * large data section out of memory and gives the writable reasonably sized writes.
 */
const UNCHUNKED_WRITE_BUFFER_SIZE = 1024 * 1024;

export type McapWriterOptions = {
  writable: IWritable;
  useStatistics?: boolean;
  useSummaryOffsets?: boolean;
  useChunks?: boolean;
  repeatSchemas?: boolean;
  repeatChannels?: boolean;
  useAttachmentIndex?: boolean;
  useMetadataIndex?: boolean;
  useMessageIndex?: boolean;
  useChunkIndex?: boolean;
  startChannelId?: number;
  /**
   * A chunk is finalized once its uncompressed records exceed this many bytes, so chunks may
   * overshoot it by up to one message and its schema and channel records. Ignored when
   * `useChunks` is false. Defaults to 1 MiB.
   */
  chunkSize?: number;
  /** Compresses a finalized chunk's records. `chunkData` is an exact-size copy the callback may keep. */
  compressChunk?: (chunkData: Uint8Array) => { compression: string; compressedData: Uint8Array };
};

/**
 * McapWriter provides an interface for writing messages to MCAP files.
 *
 * NOTE: callers must wait on any method call to complete before calling another
 * method. Calling a method before another has completed will result in a corrupt
 * MCAP file.
 */
export class McapWriter {
  #nextChannelId = 0;
  #nextSchemaId = 1;
  #writable: IWritable;
  #failed: Error | undefined;
  #recordWriter = new McapRecordBuilder();
  #schemas = new Map<number, Schema>();
  #channels = new Map<number, Channel>();
  #writtenSchemaIds = new Set<number>();
  #writtenChannelIds = new Set<number>();
  #chunkBuilder: ChunkBuilder | undefined;
  #compressChunk:
    | ((chunkData: Uint8Array) => { compression: string; compressedData: Uint8Array })
    | undefined;
  #chunkSize: number;
  /** undefined until start() is called. */
  #dataSectionCrc: number | undefined;

  public statistics: Statistics | undefined;
  #useSummaryOffsets: boolean;
  #repeatSchemas: boolean;
  #repeatChannels: boolean;

  // indices
  #chunkIndices: ChunkIndex[] | undefined;
  #attachmentIndices: AttachmentIndex[] | undefined;
  #metadataIndices: MetadataIndex[] | undefined;

  public constructor(options: McapWriterOptions) {
    const {
      writable,
      useStatistics = true,
      useSummaryOffsets = true,
      useChunks = true,
      repeatSchemas = true,
      repeatChannels = true,
      useAttachmentIndex = true,
      useMetadataIndex = true,
      useMessageIndex = true,
      useChunkIndex = true,
      startChannelId = 0,
      chunkSize = 1024 * 1024,
      compressChunk,
    } = options;

    this.#writable = writable;
    this.#useSummaryOffsets = useSummaryOffsets;
    if (useStatistics) {
      this.statistics = {
        messageCount: 0n,
        schemaCount: 0,
        channelCount: 0,
        attachmentCount: 0,
        metadataCount: 0,
        chunkCount: 0,
        messageStartTime: 0n,
        messageEndTime: 0n,
        channelMessageCounts: new Map(),
      };
    }
    if (useChunks) {
      this.#chunkBuilder = new ChunkBuilder({ useMessageIndex });
    }
    this.#repeatSchemas = repeatSchemas;
    this.#repeatChannels = repeatChannels;
    if (useAttachmentIndex) {
      this.#attachmentIndices = [];
    }
    if (useMetadataIndex) {
      this.#metadataIndices = [];
    }
    if (useChunkIndex) {
      this.#chunkIndices = [];
    }
    this.#nextChannelId = startChannelId;
    this.#chunkSize = chunkSize;
    this.#compressChunk = compressChunk;
  }

  public async start(header: Header = { profile: "", library: LIBRARY_IDENTIFIER }): Promise<void> {
    this.#throwIfFailed();
    this.#dataSectionCrc = crc32Init();
    this.#recordWriter.writeMagic();
    this.#recordWriter.writeHeader(header);

    await this.#writeRecords();
  }

  public async end(): Promise<void> {
    this.#throwIfFailed();
    await this.#finalizeChunk();

    // Flush the data section so its CRC is final. DataEnd, the summary section and the footer
    // are then built in #recordWriter and written together.
    await this.#writeRecords();

    this.#recordWriter.writeDataEnd({
      dataSectionCrc: this.#dataSectionCrc == undefined ? 0 : crc32Final(this.#dataSectionCrc),
    });

    const summaryOffsets: SummaryOffset[] = [];

    const summaryStart = this.#nextRecordOffset();
    const summaryStartInBuffer = this.#recordWriter.length;

    // A chunk index refers to channels and schemas, so the summary needs them whenever it has one
    if (this.#repeatSchemas || this.#chunkIndices) {
      const schemaStart = this.#nextRecordOffset();
      let schemaLength = 0n;
      for (const schema of this.#schemas.values()) {
        schemaLength += this.#recordWriter.writeSchema(schema);
      }
      summaryOffsets.push({
        groupOpcode: Opcode.SCHEMA,
        groupStart: schemaStart,
        groupLength: schemaLength,
      });
    }

    const summaryHasChannels = this.#repeatChannels || this.#chunkIndices != undefined;
    if (summaryHasChannels) {
      const channelStart = this.#nextRecordOffset();
      let channelLength = 0n;
      for (const channel of this.#channels.values()) {
        channelLength += this.#recordWriter.writeChannel(channel);
      }
      summaryOffsets.push({
        groupOpcode: Opcode.CHANNEL,
        groupStart: channelStart,
        groupLength: channelLength,
      });
    }

    if (this.statistics) {
      const statisticsStart = this.#nextRecordOffset();
      // Per-channel counts need the Channel records in the summary
      const statisticsLength = this.#recordWriter.writeStatistics(
        summaryHasChannels
          ? this.statistics
          : { ...this.statistics, channelMessageCounts: new Map() },
      );
      summaryOffsets.push({
        groupOpcode: Opcode.STATISTICS,
        groupStart: statisticsStart,
        groupLength: statisticsLength,
      });
    }

    if (this.#metadataIndices) {
      const metadataIndexStart = this.#nextRecordOffset();
      let metadataIndexLength = 0n;
      for (const metadataIndex of this.#metadataIndices) {
        metadataIndexLength += this.#recordWriter.writeMetadataIndex(metadataIndex);
      }
      summaryOffsets.push({
        groupOpcode: Opcode.METADATA_INDEX,
        groupStart: metadataIndexStart,
        groupLength: metadataIndexLength,
      });
    }

    if (this.#attachmentIndices) {
      const attachmentIndexStart = this.#nextRecordOffset();
      let attachmentIndexLength = 0n;
      for (const attachmentIndex of this.#attachmentIndices) {
        attachmentIndexLength += this.#recordWriter.writeAttachmentIndex(attachmentIndex);
      }
      summaryOffsets.push({
        groupOpcode: Opcode.ATTACHMENT_INDEX,
        groupStart: attachmentIndexStart,
        groupLength: attachmentIndexLength,
      });
    }

    if (this.#chunkIndices) {
      const chunkIndexStart = this.#nextRecordOffset();
      let chunkIndexLength = 0n;
      for (const chunkIndex of this.#chunkIndices) {
        chunkIndexLength += this.#recordWriter.writeChunkIndex(chunkIndex);
      }
      summaryOffsets.push({
        groupOpcode: Opcode.CHUNK_INDEX,
        groupStart: chunkIndexStart,
        groupLength: chunkIndexLength,
      });
    }

    const summaryOffsetStart = this.#nextRecordOffset();
    const summaryLength = summaryOffsetStart - summaryStart;

    let wroteSummaryOffsets = false;
    if (this.#useSummaryOffsets) {
      for (const summaryOffset of summaryOffsets) {
        if (summaryOffset.groupLength !== 0n) {
          this.#recordWriter.writeSummaryOffset(summaryOffset);
          wroteSummaryOffsets = true;
        }
      }
    }

    // The summary CRC covers the summary section and summary offsets (not DataEnd), plus the
    // footer fields up to the CRC itself. This is a small copy rather than a subarray: the
    // subarray would start at an unaligned offset, and feeding crc32Update one unaligned input
    // measurably slows its optimized code for the large aligned buffers on the hot path.
    let summaryCrc = crc32Update(
      crc32Init(),
      this.#recordWriter.bufferView().slice(summaryStartInBuffer),
    );

    const footer: Footer = {
      summaryStart: summaryLength === 0n ? 0n : summaryStart,
      // Zero when no Summary Offset record follows, as the spec requires
      summaryOffsetStart: wroteSummaryOffsets ? summaryOffsetStart : 0n,
      summaryCrc: 0,
    };
    const tempBuffer = new DataView(new ArrayBuffer(1 + 8 + 8 + 8));
    tempBuffer.setUint8(0, Opcode.FOOTER);
    tempBuffer.setBigUint64(1, 8n + 8n + 4n, true);
    tempBuffer.setBigUint64(1 + 8, footer.summaryStart, true);
    tempBuffer.setBigUint64(1 + 8 + 8, footer.summaryOffsetStart, true);
    summaryCrc = crc32Update(summaryCrc, tempBuffer);
    footer.summaryCrc = crc32Final(summaryCrc);

    this.#recordWriter.writeFooter(footer);

    this.#recordWriter.writeMagic();

    // .buffer is a copy, so reset before awaiting the write
    const data = this.#recordWriter.buffer;
    this.#recordWriter.reset();
    await this.#write(data);
  }

  /**
   * Add a schema and return a generated schema id. The schema id is used when adding channels.
   */
  public async registerSchema(info: Omit<Schema, "id">): Promise<number> {
    this.#throwIfFailed();
    if (this.#nextSchemaId > 0xffff) {
      throw new Error("Too many schemas: MCAP schema ids are 16-bit");
    }
    const id = this.#nextSchemaId++;
    this.#schemas.set(id, { ...info, id });
    if (this.statistics) {
      ++this.statistics.schemaCount;
    }
    return id;
  }

  /**
   * Add a channel and return a generated channel id. The channel id is used when adding messages.
   */
  public async registerChannel(info: Omit<Channel, "id">): Promise<number> {
    this.#throwIfFailed();
    if (this.#nextChannelId > 0xffff) {
      throw new Error("Too many channels: MCAP channel ids are 16-bit");
    }
    const id = this.#nextChannelId++;
    this.#channels.set(id, { ...info, id });
    if (this.statistics) {
      ++this.statistics.channelCount;
    }
    return id;
  }

  public async addMessage(message: Message): Promise<void> {
    this.#throwIfFailed();
    // write out channel and schema if we have not yet done so
    if (!this.#writtenChannelIds.has(message.channelId)) {
      const channel = this.#channels.get(message.channelId);
      if (!channel) {
        throw new Error(
          `McapWriter#addMessage failed: missing channel for id ${message.channelId}`,
        );
      }

      if (channel.schemaId !== 0 && !this.#writtenSchemaIds.has(channel.schemaId)) {
        const schema = this.#schemas.get(channel.schemaId);
        if (!schema) {
          throw new Error(
            `McapWriter#addMessage failed: missing schema for id ${channel.schemaId}`,
          );
        }
        if (this.#chunkBuilder) {
          this.#chunkBuilder.addSchema(schema);
        } else {
          this.#recordWriter.writeSchema(schema);
        }
        this.#writtenSchemaIds.add(channel.schemaId);
      }

      if (this.#chunkBuilder) {
        this.#chunkBuilder.addChannel(channel);
      } else {
        this.#recordWriter.writeChannel(channel);
      }
      this.#writtenChannelIds.add(message.channelId);
    }

    // Count the message only once its channel and schema are known to exist.
    if (this.statistics) {
      if (this.statistics.messageCount === 0n) {
        this.statistics.messageStartTime = message.logTime;
        this.statistics.messageEndTime = message.logTime;
      } else {
        if (message.logTime < this.statistics.messageStartTime) {
          this.statistics.messageStartTime = message.logTime;
        }
        if (message.logTime > this.statistics.messageEndTime) {
          this.statistics.messageEndTime = message.logTime;
        }
      }
      this.statistics.channelMessageCounts.set(
        message.channelId,
        (this.statistics.channelMessageCounts.get(message.channelId) ?? 0n) + 1n,
      );
      ++this.statistics.messageCount;
    }

    if (this.#chunkBuilder) {
      this.#chunkBuilder.addMessage(message);
      if (this.#chunkBuilder.byteLength > this.#chunkSize) {
        await this.#finalizeChunk();
      }
    } else {
      this.#recordWriter.writeMessage(message);
      if (this.#recordWriter.length > UNCHUNKED_WRITE_BUFFER_SIZE) {
        await this.#writeRecords();
      }
    }
  }

  public async addAttachment(attachment: Attachment): Promise<void> {
    this.#throwIfFailed();
    const offset = this.#nextRecordOffset();
    const length = this.#recordWriter.writeAttachment(attachment);
    if (this.statistics) {
      ++this.statistics.attachmentCount;
    }

    if (this.#attachmentIndices) {
      this.#attachmentIndices.push({
        logTime: attachment.logTime,
        createTime: attachment.createTime,
        name: attachment.name,
        mediaType: attachment.mediaType,
        offset,
        dataSize: BigInt(attachment.data.byteLength),
        length,
      });
    }

    await this.#writeRecords();
  }

  public async addMetadata(metadata: Metadata): Promise<void> {
    this.#throwIfFailed();
    const offset = this.#nextRecordOffset();
    const recordSize = this.#recordWriter.writeMetadata(metadata);
    if (this.statistics) {
      ++this.statistics.metadataCount;
    }

    if (this.#metadataIndices) {
      this.#metadataIndices.push({
        name: metadata.name,
        offset,
        length: recordSize,
      });
    }

    await this.#writeRecords();
  }

  /**
   * The file offset the next record written to #recordWriter will land at. This accounts for
   * records that have been built but not yet flushed to the writable.
   */
  #nextRecordOffset(): bigint {
    return this.#writable.position() + BigInt(this.#recordWriter.length);
  }

  /**
   * Writes everything pending in #recordWriter to the output, folding it into the data section
   * CRC.
   */
  async #writeRecords(): Promise<void> {
    if (this.#recordWriter.length === 0) {
      return;
    }
    if (this.#dataSectionCrc != undefined) {
      this.#dataSectionCrc = crc32Update(this.#dataSectionCrc, this.#recordWriter.bufferView());
    }
    // .buffer is a copy, so reset before awaiting the write
    const data = this.#recordWriter.buffer;
    this.#recordWriter.reset();
    await this.#write(data);
  }

  /**
   * A failed write leaves records that were indexed and counted in the CRC but never written, so
   * the writer refuses everything after it instead of finishing a file whose index lies.
   */
  async #write(data: Uint8Array): Promise<void> {
    try {
      await this.#writable.write(data);
    } catch (error) {
      this.#failed = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }

  #throwIfFailed(): void {
    if (this.#failed) {
      throw new Error("An earlier write failed; this MCAP writer can't continue", {
        cause: this.#failed,
      });
    }
  }

  async #finalizeChunk(): Promise<void> {
    if (!this.#chunkBuilder || this.#chunkBuilder.numMessages === 0) {
      return;
    }
    if (this.statistics) {
      ++this.statistics.chunkCount;
    }

    // A view, not a copy: writeChunk() below copies the records into #recordWriter before the
    // chunk builder is reset. The view stays internal; the compressChunk callback gets an
    // exact-size copy, since its backing buffer is public API.
    const chunkData = this.#chunkBuilder.bufferView();
    const uncompressedSize = BigInt(chunkData.length);
    const uncompressedCrc = crc32(chunkData);
    let compression = "";
    let compressedData = chunkData;
    if (this.#compressChunk) {
      ({ compression, compressedData } = this.#compressChunk(chunkData.slice()));
    }

    const chunkRecord: Chunk = {
      messageStartTime: this.#chunkBuilder.messageStartTime,
      messageEndTime: this.#chunkBuilder.messageEndTime,
      uncompressedSize,
      uncompressedCrc,
      compression,
      records: compressedData,
    };

    const chunkStartOffset = this.#nextRecordOffset();

    const chunkLength = this.#recordWriter.writeChunk(chunkRecord);

    const messageIndexOffsets = this.#chunkIndices ? new Map<number, bigint>() : undefined;

    const messageIndexStart = this.#nextRecordOffset();
    let messageIndexLength = 0n;
    for (const messageIndex of this.#chunkBuilder.indices) {
      messageIndexOffsets?.set(messageIndex.channelId, messageIndexStart + messageIndexLength);
      messageIndexLength += this.#recordWriter.writeMessageIndex(messageIndex);
    }

    if (this.#chunkIndices) {
      this.#chunkIndices.push({
        messageStartTime: chunkRecord.messageStartTime,
        messageEndTime: chunkRecord.messageEndTime,
        chunkStartOffset,
        chunkLength,
        messageIndexOffsets: messageIndexOffsets!,
        messageIndexLength,
        compression: chunkRecord.compression,
        compressedSize: BigInt(chunkRecord.records.byteLength),
        uncompressedSize: chunkRecord.uncompressedSize,
      });
    }
    this.#chunkBuilder.reset();

    await this.#writeRecords();
  }
}
