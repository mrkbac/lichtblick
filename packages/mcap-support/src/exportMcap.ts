// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { IWritable, McapIndexedReader, McapRecordBuilder, McapTypes, Opcode } from "@mcap/core";

import { loadDecompressHandlers } from "./decompressHandlers";

export type ExportTopicOptions = {
  /** Topic name in the output file. Defaults to the input topic name. */
  outputTopic?: string;
  /** Keep only every Nth message of this topic (1 = keep all). */
  everyNth?: number;
};

export type ExportCompression = "zstd" | "none";

export type ExportMcapOptions = {
  /** Input topics to keep. Topics not in this map are dropped. */
  topics: ReadonlyMap<string, ExportTopicOptions>;
  /** Inclusive log time range in nanoseconds. Defaults to the whole file. */
  startTime?: bigint;
  endTime?: bigint;
  includeAttachments?: boolean;
  includeMetadata?: boolean;
  /** Compression of chunks that have to be rewritten. Default zstd. */
  compression?: ExportCompression;
  /**
   * Rewrites one chunk. Pass a function that runs {@link rewriteChunk} in a worker pool to
   * spread the work over several cores. Defaults to running it on the calling thread.
   */
  processChunk?: (job: ChunkJob) => Promise<ChunkResult | undefined>;
  /** How many chunks may be in flight at once. Use the worker pool size. Default 1. */
  concurrency?: number;
  /** Called with a value between 0 and 1 as chunks are written. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

export type ExportMcapResult = {
  messageCount: number;
};

/** A chunk whose messages need filtering. Sent to {@link rewriteChunk}, possibly in a worker. */
export type ChunkJob = {
  /** The chunk's (compressed) records. */
  records: Uint8Array;
  compression: string;
  uncompressedSize: bigint;
  startTime: bigint;
  endTime: bigint;
  /** Kept channel id -> decimation. Messages of other channels are dropped. */
  channels: ReadonlyMap<number, { topic: string; everyNth: number }>;
  /** Number of in-range messages per topic before this chunk, for decimation. */
  topicCounters: ReadonlyMap<string, number>;
  outputCompression: ExportCompression;
};

/** A rewritten chunk: a Chunk record followed by its MessageIndex records. */
export type ChunkResult = {
  bytes: Uint8Array;
  chunkLength: bigint;
  /** Offsets of the MessageIndex records relative to the start of `bytes`. */
  messageIndexOffsets: Map<number, bigint>;
  messageIndexLength: bigint;
  messageStartTime: bigint;
  messageEndTime: bigint;
  compression: string;
  compressedSize: bigint;
  uncompressedSize: bigint;
  channelMessageCounts: Map<number, number>;
  /** In-range messages per topic seen in this chunk, including decimated ones. */
  topicSeen: Map<string, number>;
};

export type RewriteChunkDeps = {
  decompressHandlers: McapTypes.DecompressHandlers;
  compressZstd: (data: Uint8Array) => Uint8Array;
};

const MAX_TIME = 0xffff_ffff_ffff_ffffn;
const RECORD_PREFIX = 1 + 8; // opcode + record length
const MESSAGE_LOG_TIME = 2 + 4; // channel id + sequence
const MESSAGE_INDEX_ENTRY = 8 + 8; // log time + offset

/**
 * Filters one chunk's messages by channel, time and decimation, working on raw record bytes.
 * Returns undefined when no message is kept.
 */
export function rewriteChunk(job: ChunkJob, deps: RewriteChunkDeps): ChunkResult | undefined {
  let records = job.records;
  if (job.compression !== "") {
    const decompress = deps.decompressHandlers[job.compression];
    if (!decompress) {
      throw new Error(`Unsupported chunk compression: ${job.compression}`);
    }
    records = decompress(job.records, job.uncompressedSize);
  }

  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  const out = new Uint8Array(records.byteLength);
  let outLength = 0;
  const indexes = new Map<number, [bigint, bigint][]>();
  const counters = new Map(job.topicCounters);
  const topicSeen = new Map<string, number>();
  let messageStartTime: bigint | undefined;
  let messageEndTime = 0n;

  for (let offset = 0; offset + RECORD_PREFIX <= records.byteLength; ) {
    const opcode = view.getUint8(offset);
    const recordLength = RECORD_PREFIX + Number(view.getBigUint64(offset + 1, true));
    const start = offset;
    offset += recordLength;
    if (opcode !== Opcode.MESSAGE) {
      continue;
    }
    const channelId = view.getUint16(start + RECORD_PREFIX, true);
    const channel = job.channels.get(channelId);
    if (!channel) {
      continue;
    }
    const logTime = view.getBigUint64(start + RECORD_PREFIX + MESSAGE_LOG_TIME, true);
    if (logTime < job.startTime || logTime > job.endTime) {
      continue;
    }
    const seen = counters.get(channel.topic) ?? 0;
    counters.set(channel.topic, seen + 1);
    topicSeen.set(channel.topic, (topicSeen.get(channel.topic) ?? 0) + 1);
    if (seen % channel.everyNth !== 0) {
      continue;
    }
    let index = indexes.get(channelId);
    if (!index) {
      index = [];
      indexes.set(channelId, index);
    }
    index.push([logTime, BigInt(outLength)]);
    out.set(records.subarray(start, start + recordLength), outLength);
    outLength += recordLength;
    if (messageStartTime == undefined || logTime < messageStartTime) {
      messageStartTime = logTime;
    }
    if (logTime > messageEndTime) {
      messageEndTime = logTime;
    }
  }

  if (messageStartTime == undefined) {
    return undefined;
  }

  const uncompressed = out.subarray(0, outLength);
  let compression = "";
  let compressed: Uint8Array = uncompressed;
  if (job.outputCompression === "zstd") {
    const zstd = deps.compressZstd(uncompressed);
    if (zstd.byteLength < uncompressed.byteLength) {
      compression = "zstd";
      compressed = zstd;
    }
  }

  const builder = new McapRecordBuilder();
  // uncompressedCrc 0 means "not computed", which the spec allows.
  builder.writeChunk({
    messageStartTime,
    messageEndTime,
    uncompressedSize: BigInt(outLength),
    uncompressedCrc: 0,
    compression,
    records: compressed,
  });
  const chunkLength = BigInt(builder.length);
  const messageIndexOffsets = new Map<number, bigint>();
  const channelMessageCounts = new Map<number, number>();
  for (const [channelId, index] of indexes) {
    messageIndexOffsets.set(channelId, BigInt(builder.length));
    channelMessageCounts.set(channelId, index.length);
    builder.writeMessageIndex({ channelId, records: index });
  }

  return {
    bytes: builder.buffer.slice(),
    chunkLength,
    messageIndexOffsets,
    messageIndexLength: BigInt(builder.length) - chunkLength,
    messageStartTime,
    messageEndTime,
    compression,
    compressedSize: BigInt(compressed.byteLength),
    uncompressedSize: BigInt(outLength),
    channelMessageCounts,
    topicSeen,
  };
}

/** Loads the decompressors and the zstd compressor needed by {@link rewriteChunk}. */
export async function loadRewriteChunkDeps(): Promise<RewriteChunkDeps> {
  const [decompressHandlers, zstd] = await Promise.all([
    loadDecompressHandlers(),
    import("@lichtblick/wasm-zstd"),
  ]);
  await zstd.isLoaded;
  return { decompressHandlers, compressZstd: (data) => new Uint8Array(zstd.compress(data)) };
}

/** Counts MessageIndex entries per channel: all of them, and those in [startTime, endTime]. */
function countIndexedMessages(
  bytes: Uint8Array,
  startTime: bigint,
  endTime: bigint,
): Map<number, { total: number; inRange: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const counts = new Map<number, { total: number; inRange: number }>();
  for (let offset = 0; offset + RECORD_PREFIX <= bytes.byteLength; ) {
    const opcode = view.getUint8(offset);
    const recordLength = RECORD_PREFIX + Number(view.getBigUint64(offset + 1, true));
    if (opcode === Opcode.MESSAGE_INDEX) {
      const channelId = view.getUint16(offset + RECORD_PREFIX, true);
      const entriesLength = view.getUint32(offset + RECORD_PREFIX + 2, true);
      const entriesStart = offset + RECORD_PREFIX + 2 + 4;
      let inRange = 0;
      for (let entry = 0; entry < entriesLength; entry += MESSAGE_INDEX_ENTRY) {
        const logTime = view.getBigUint64(entriesStart + entry, true);
        if (logTime >= startTime && logTime <= endTime) {
          inRange++;
        }
      }
      counts.set(channelId, { total: entriesLength / MESSAGE_INDEX_ENTRY, inRange });
    }
    offset += recordLength;
  }
  return counts;
}

/**
 * Writes a new MCAP file containing the messages of `reader` within a time range, keeping only
 * selected topics, optionally renaming them and decimating them.
 *
 * Channel and schema ids are preserved, so chunks that lie fully in the range and contain only
 * kept, undecimated channels are copied as-is without decompressing them. Other chunks are
 * filtered record by record via `processChunk`. Message payloads are never decoded, so this
 * works for every message encoding.
 */
export async function exportMcap(
  reader: McapIndexedReader,
  readable: McapTypes.IReadable,
  writable: IWritable,
  options: ExportMcapOptions,
): Promise<ExportMcapResult> {
  const { topics, signal, onProgress } = options;
  const outputCompression = options.compression ?? "zstd";
  const outputChunkCompression = outputCompression === "zstd" ? "zstd" : "";
  const startTime = options.startTime ?? 0n;
  const endTime = options.endTime ?? MAX_TIME;
  const isFullRange =
    startTime <= (reader.statistics?.messageStartTime ?? 0n) &&
    endTime >= (reader.statistics?.messageEndTime ?? MAX_TIME);

  let processChunk = options.processChunk;
  if (!processChunk) {
    const deps = await loadRewriteChunkDeps();
    processChunk = async (job) => rewriteChunk(job, deps);
  }
  const concurrency = Math.max(1, options.concurrency ?? 1);

  let position = 0n;
  const builder = new McapRecordBuilder();
  const flush = async () => {
    if (builder.length > 0) {
      await writable.write(builder.buffer);
      position += BigInt(builder.length);
      builder.reset();
    }
  };

  builder.writeMagic();
  builder.writeHeader({ profile: reader.header.profile, library: "Lichtblick" });

  // Kept channels keep their ids, so copied chunks stay valid.
  const keptChannels = new Map<number, McapTypes.Channel>();
  const keptSchemas = new Map<number, McapTypes.Schema>();
  // Decimation counts per input topic, since one topic can span several channels.
  const jobChannels = new Map<number, { topic: string; everyNth: number }>();
  for (const channel of reader.channelsById.values()) {
    const topicOptions = topics.get(channel.topic);
    if (!topicOptions) {
      continue;
    }
    keptChannels.set(channel.id, { ...channel, topic: topicOptions.outputTopic ?? channel.topic });
    jobChannels.set(channel.id, {
      topic: channel.topic,
      everyNth: Math.max(1, Math.floor(topicOptions.everyNth ?? 1)),
    });
    const schema = reader.schemasById.get(channel.schemaId);
    if (schema) {
      keptSchemas.set(schema.id, schema);
    }
  }
  keptSchemas.forEach((schema) => builder.writeSchema(schema));
  keptChannels.forEach((channel) => builder.writeChannel(channel));
  const decimating = [...jobChannels.values()].some((channel) => channel.everyNth > 1);

  const chunkIndexes: McapTypes.ChunkIndex[] = [];
  const channelMessageCounts = new Map<number, bigint>();
  let messageCount = 0;
  let messageStartTime: bigint | undefined;
  let messageEndTime = 0n;

  const writeChunk = async (result: ChunkResult) => {
    await flush();
    const chunkStartOffset = position;
    await writable.write(result.bytes);
    position += BigInt(result.bytes.byteLength);
    chunkIndexes.push({
      messageStartTime: result.messageStartTime,
      messageEndTime: result.messageEndTime,
      chunkStartOffset,
      chunkLength: result.chunkLength,
      messageIndexOffsets: new Map(
        [...result.messageIndexOffsets].map(([id, offset]) => [id, chunkStartOffset + offset]),
      ),
      messageIndexLength: result.messageIndexLength,
      compression: result.compression,
      compressedSize: result.compressedSize,
      uncompressedSize: result.uncompressedSize,
    });
    for (const [id, count] of result.channelMessageCounts) {
      channelMessageCounts.set(id, (channelMessageCounts.get(id) ?? 0n) + BigInt(count));
      messageCount += count;
    }
    if (messageStartTime == undefined || result.messageStartTime < messageStartTime) {
      messageStartTime = result.messageStartTime;
    }
    if (result.messageEndTime > messageEndTime) {
      messageEndTime = result.messageEndTime;
    }
  };

  const chunks = reader.chunkIndexes
    .filter((chunk) => chunk.messageEndTime >= startTime && chunk.messageStartTime <= endTime)
    .sort((a, b) => (a.chunkStartOffset < b.chunkStartOffset ? -1 : 1));
  const totalBytes = Math.max(
    1,
    chunks.reduce((sum, chunk) => sum + Number(chunk.compressedSize), 0),
  );
  let doneBytes = 0;

  // Chunks are processed concurrently but written in file order.
  const inFlight: Promise<{ result?: ChunkResult; size: number }>[] = [];
  const writeNext = async () => {
    const { result, size } = await inFlight.shift()!;
    if (result) {
      await writeChunk(result);
    }
    doneBytes += size;
    onProgress?.(doneBytes / totalBytes);
  };
  const topicCounters = new Map<string, number>();
  const addToCounters = (seen: Iterable<[string, number]>) => {
    for (const [topic, count] of seen) {
      topicCounters.set(topic, (topicCounters.get(topic) ?? 0) + count);
    }
  };

  for (const chunk of chunks) {
    signal?.throwIfAborted();
    const chunkChannels = [...chunk.messageIndexOffsets.keys()];
    const hasIndexes = chunkChannels.length > 0;
    const size = Number(chunk.compressedSize);
    if (hasIndexes && !chunkChannels.some((id) => keptChannels.has(id))) {
      doneBytes += size;
      continue;
    }

    while (inFlight.length >= concurrency * 2) {
      await writeNext();
    }

    const bytes = await readable.read(
      chunk.chunkStartOffset,
      chunk.chunkLength + chunk.messageIndexLength,
    );
    const indexCounts = hasIndexes
      ? countIndexedMessages(bytes.subarray(Number(chunk.chunkLength)), startTime, endTime)
      : undefined;

    // A chunk may embed Channel records. A renamed channel's embedded record would still carry
    // the old topic, so such chunks are rewritten, which drops embedded records.
    const copyAsIs =
      indexCounts != undefined &&
      chunk.messageStartTime >= startTime &&
      chunk.messageEndTime <= endTime &&
      chunk.compression === outputChunkCompression &&
      chunkChannels.every(
        (id) =>
          jobChannels.get(id)?.everyNth === 1 &&
          keptChannels.get(id)!.topic === jobChannels.get(id)!.topic,
      );
    if (copyAsIs) {
      inFlight.push(
        Promise.resolve({
          size,
          result: {
            bytes,
            chunkLength: chunk.chunkLength,
            messageIndexOffsets: new Map(
              [...chunk.messageIndexOffsets].map(([id, offset]) => [
                id,
                offset - chunk.chunkStartOffset,
              ]),
            ),
            messageIndexLength: chunk.messageIndexLength,
            messageStartTime: chunk.messageStartTime,
            messageEndTime: chunk.messageEndTime,
            compression: chunk.compression,
            compressedSize: chunk.compressedSize,
            uncompressedSize: chunk.uncompressedSize,
            channelMessageCounts: new Map(
              [...indexCounts].map(([id, counts]) => [id, counts.total]),
            ),
            topicSeen: new Map(),
          },
        }),
      );
      continue;
    }

    // Decimation needs per-topic counts from all earlier chunks. Message indexes give them
    // up front; without indexes, earlier chunks must finish first.
    const sequential = decimating && !indexCounts;
    if (sequential) {
      while (inFlight.length > 0) {
        await writeNext();
      }
    }
    const job: ChunkJob = {
      // A copy, so the records can be transferred to a worker on their own.
      records: bytes.slice(
        Number(chunk.chunkLength - chunk.compressedSize),
        Number(chunk.chunkLength),
      ),
      compression: chunk.compression,
      uncompressedSize: chunk.uncompressedSize,
      startTime,
      endTime,
      channels: jobChannels,
      topicCounters: new Map(topicCounters),
      outputCompression,
    };
    if (decimating && indexCounts) {
      addToCounters(
        [...indexCounts]
          .filter(([id]) => jobChannels.has(id))
          .map(([id, counts]) => [jobChannels.get(id)!.topic, counts.inRange]),
      );
    }
    const pending = processChunk(job).then((result) => {
      if (sequential && result) {
        addToCounters(result.topicSeen);
      }
      return { result, size };
    });
    // Rejections are handled when the promise is awaited in order; avoid unhandled warnings.
    pending.catch(() => {});
    inFlight.push(pending);
    if (sequential) {
      await writeNext();
    }
  }
  while (inFlight.length > 0) {
    await writeNext();
  }

  const attachmentIndexes: McapTypes.AttachmentIndex[] = [];
  if (options.includeAttachments === true) {
    // A full-range export keeps attachments outside the first and last message times too.
    for await (const attachment of reader.readAttachments(
      isFullRange ? {} : { startTime, endTime },
    )) {
      signal?.throwIfAborted();
      await flush();
      const offset = position;
      const length = builder.writeAttachment(attachment);
      attachmentIndexes.push({
        offset,
        length,
        logTime: attachment.logTime,
        createTime: attachment.createTime,
        dataSize: BigInt(attachment.data.byteLength),
        name: attachment.name,
        mediaType: attachment.mediaType,
      });
    }
  }
  const metadataIndexes: McapTypes.MetadataIndex[] = [];
  if (options.includeMetadata === true) {
    for await (const metadata of reader.readMetadata()) {
      await flush();
      const offset = position;
      const length = builder.writeMetadata(metadata);
      metadataIndexes.push({ offset, length, name: metadata.name });
    }
  }
  signal?.throwIfAborted();

  builder.writeDataEnd({ dataSectionCrc: 0 });
  await flush();

  // Summary section: one group per record type, each located by a SummaryOffset.
  const summaryStart = position;
  const summaryOffsets: McapTypes.SummaryOffset[] = [];
  const writeGroup = async (groupOpcode: Opcode, write: () => void) => {
    write();
    if (builder.length > 0) {
      summaryOffsets.push({
        groupOpcode,
        groupStart: position,
        groupLength: BigInt(builder.length),
      });
    }
    await flush();
  };
  await writeGroup(Opcode.SCHEMA, () => {
    keptSchemas.forEach((schema) => builder.writeSchema(schema));
  });
  await writeGroup(Opcode.CHANNEL, () => {
    keptChannels.forEach((channel) => builder.writeChannel(channel));
  });
  await writeGroup(Opcode.STATISTICS, () => {
    builder.writeStatistics({
      messageCount: BigInt(messageCount),
      schemaCount: keptSchemas.size,
      channelCount: keptChannels.size,
      attachmentCount: attachmentIndexes.length,
      metadataCount: metadataIndexes.length,
      chunkCount: chunkIndexes.length,
      messageStartTime: messageStartTime ?? 0n,
      messageEndTime,
      channelMessageCounts,
    });
  });
  await writeGroup(Opcode.CHUNK_INDEX, () => {
    chunkIndexes.forEach((index) => builder.writeChunkIndex(index));
  });
  await writeGroup(Opcode.ATTACHMENT_INDEX, () => {
    attachmentIndexes.forEach((index) => builder.writeAttachmentIndex(index));
  });
  await writeGroup(Opcode.METADATA_INDEX, () => {
    metadataIndexes.forEach((index) => builder.writeMetadataIndex(index));
  });
  const summaryOffsetStart = position;
  summaryOffsets.forEach((offset) => builder.writeSummaryOffset(offset));
  builder.writeFooter({ summaryStart, summaryOffsetStart, summaryCrc: 0 });
  builder.writeMagic();
  await flush();

  onProgress?.(1);
  return { messageCount };
}
