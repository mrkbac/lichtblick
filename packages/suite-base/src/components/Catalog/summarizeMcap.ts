// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapIndexedReader } from "@mcap/core";

import { fromNanoSec } from "@foxglove/rostime";
import { BlobReadable } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/BlobReadable";

import { CatalogSummary, CatalogTopic } from "./types";

const SANE_START_NS = 946_684_800n * 1_000_000_000n; // 2000-01-01
const DAY_NS = 86_400n * 1_000_000_000n;

/**
 * Read only the summary section of an MCAP file: topics, message counts and time bounds. Message
 * data is never read, so this stays fast for large recordings.
 */
export async function summarizeMcap(file: Blob, nowMs = Date.now()): Promise<CatalogSummary> {
  let reader: McapIndexedReader;
  try {
    reader = await McapIndexedReader.Initialize({ readable: new BlobReadable(file) });
  } catch (err: unknown) {
    // @mcap/core throws this when the file has no summary section.
    if (err instanceof Error && err.message.includes("File is not indexed")) {
      return { noSummary: true };
    }
    throw err;
  }

  const counts = reader.statistics?.channelMessageCounts;
  const topics = new Map<string, CatalogTopic>();
  for (const channel of reader.channelsById.values()) {
    const schema = reader.schemasById.get(channel.schemaId)?.name ?? "";
    const count = counts?.get(channel.id);
    const messages = count == undefined ? undefined : Number(count);
    const topic = topics.get(channel.topic);
    if (!topic) {
      topics.set(channel.topic, { name: channel.topic, schema, messages });
      continue;
    }
    if (topic.schema !== schema) {
      topic.schema = "(multiple)";
    }
    if (messages != undefined) {
      topic.messages = (topic.messages ?? 0) + messages;
    }
  }

  // Chunk indexes give per-chunk bounds, so a few chunks with bogus stamps can be ignored. Fall back
  // to all stamps when none look like wall-clock time (e.g. simulation time starting at 0).
  const stamps = reader.chunkIndexes.flatMap((chunk) => [
    chunk.messageStartTime,
    chunk.messageEndTime,
  ]);
  if (stamps.length === 0 && reader.statistics && reader.statistics.messageCount > 0n) {
    stamps.push(reader.statistics.messageStartTime, reader.statistics.messageEndTime);
  }
  const latestSaneNs = BigInt(nowMs) * 1_000_000n + DAY_NS;
  const sane = stamps.filter((stamp) => stamp >= SANE_START_NS && stamp <= latestSaneNs);
  const bounds = sane.length > 0 ? sane : stamps;
  const start = bounds.reduce<bigint | undefined>(
    (a, b) => (a == undefined || b < a ? b : a),
    undefined,
  );
  const end = bounds.reduce<bigint | undefined>(
    (a, b) => (a == undefined || b > a ? b : a),
    undefined,
  );

  return {
    start: start == undefined ? undefined : fromNanoSec(start),
    end: end == undefined ? undefined : fromNanoSec(end),
    messages: reader.statistics == undefined ? undefined : Number(reader.statistics.messageCount),
    topics: [...topics.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
