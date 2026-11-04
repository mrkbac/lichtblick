// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { IWritable, McapIndexedReader, McapWriter, McapWriterOptions } from "@mcap/core";

export type ExportTopicOptions = {
  /** Topic name in the output file. Defaults to the input topic name. */
  outputTopic?: string;
  /** Keep only every Nth message of this topic (1 = keep all). */
  everyNth?: number;
};

export type ExportMcapOptions = {
  /** Input topics to keep. Topics not in this map are dropped. */
  topics: ReadonlyMap<string, ExportTopicOptions>;
  /** Inclusive log time range in nanoseconds. Defaults to the whole file. */
  startTime?: bigint;
  endTime?: bigint;
  includeAttachments?: boolean;
  includeMetadata?: boolean;
  compressChunk?: McapWriterOptions["compressChunk"];
  chunkSize?: number;
  /** Called with a value between 0 and 1 as messages are written. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

export type ExportMcapResult = {
  messageCount: number;
};

/**
 * Writes a new MCAP file containing the messages of `reader` within a time range, keeping only
 * selected topics, optionally renaming them and decimating them. Message payloads are copied
 * byte-for-byte, so this works for every message encoding.
 */
export async function exportMcap(
  reader: McapIndexedReader,
  writable: IWritable,
  options: ExportMcapOptions,
): Promise<ExportMcapResult> {
  const { topics, startTime, endTime, signal, onProgress } = options;

  const writer = new McapWriter({
    writable,
    compressChunk: options.compressChunk,
    chunkSize: options.chunkSize,
  });
  await writer.start({ profile: reader.header.profile, library: "Lichtblick" });

  // Register every kept channel up front so topics without messages in the range still appear.
  const outSchemaIds = new Map<number, number>();
  const outChannels = new Map<number, { id: number; everyNth: number; seen: number }>();
  for (const channel of reader.channelsById.values()) {
    const topicOptions = topics.get(channel.topic);
    if (!topicOptions) {
      continue;
    }
    let schemaId = 0;
    const schema = reader.schemasById.get(channel.schemaId);
    if (schema) {
      schemaId = outSchemaIds.get(schema.id) ?? (await writer.registerSchema(schema));
      outSchemaIds.set(schema.id, schemaId);
    }
    const id = await writer.registerChannel({
      topic: topicOptions.outputTopic ?? channel.topic,
      schemaId,
      messageEncoding: channel.messageEncoding,
      metadata: channel.metadata,
    });
    outChannels.set(channel.id, {
      id,
      everyNth: Math.max(1, Math.floor(topicOptions.everyNth ?? 1)),
      seen: 0,
    });
  }

  const rangeStart = startTime ?? reader.statistics?.messageStartTime ?? 0n;
  const rangeEnd = endTime ?? reader.statistics?.messageEndTime ?? rangeStart;
  const rangeLength = Math.max(1, Number(rangeEnd - rangeStart));

  let messageCount = 0;
  for await (const message of reader.readMessages({
    topics: [...topics.keys()],
    startTime,
    endTime,
  })) {
    signal?.throwIfAborted();
    const out = outChannels.get(message.channelId);
    if (!out) {
      continue;
    }
    const keep = out.seen % out.everyNth === 0;
    out.seen++;
    if (!keep) {
      continue;
    }
    await writer.addMessage({ ...message, channelId: out.id });
    messageCount++;
    if (messageCount % 1000 === 0) {
      onProgress?.(Number(message.logTime - rangeStart) / rangeLength);
    }
  }

  if (options.includeAttachments === true) {
    for await (const attachment of reader.readAttachments({ startTime, endTime })) {
      signal?.throwIfAborted();
      await writer.addAttachment(attachment);
    }
  }
  if (options.includeMetadata === true) {
    for await (const metadata of reader.readMetadata()) {
      await writer.addMetadata(metadata);
    }
  }

  await writer.end();
  onProgress?.(1);
  return { messageCount };
}

/** Loads the zstd compressor and returns a `compressChunk` function for {@link exportMcap}. */
export async function loadZstdCompressChunk(): Promise<
  NonNullable<McapWriterOptions["compressChunk"]>
> {
  const zstd = await import("@lichtblick/wasm-zstd");
  await zstd.isLoaded;
  return (data) => ({ compression: "zstd", compressedData: new Uint8Array(zstd.compress(data)) });
}
