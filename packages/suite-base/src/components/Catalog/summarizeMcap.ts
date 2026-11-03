// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapIndexedReader } from "@mcap/core";

import { loadDecompressHandlers } from "@lichtblick/mcap-support";
import { fromNanoSec } from "@lichtblick/rostime";
import { BlobReadable } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/BlobReadable";

import { Previews, renderPreviews } from "./preview";
import { sampleRecording } from "./sampleRecording";
import { CatalogSummary, CatalogTopic } from "./types";

const SANE_START_NS = 946_684_800n * 1_000_000_000n; // 2000-01-01
const DAY_NS = 86_400n * 1_000_000_000n;

/**
 * Read the summary section of an MCAP file: topics, message counts and time bounds. Message data is
 * only read from a fixed number of sampled chunks (GPS tracks and camera previews), so this stays
 * fast for large recordings.
 */
export async function summarizeMcap(
  file: Blob,
  nowMs = Date.now(),
): Promise<CatalogSummary & { previews?: Previews }> {
  let reader: McapIndexedReader;
  try {
    reader = await McapIndexedReader.Initialize({
      readable: new BlobReadable(file),
      decompressHandlers: await loadDecompressHandlers(),
    });
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

  // Thumbnail, previews and GPS tracks are optional extras; failing to read them must not hide the
  // rest of the summary.
  let tracks: CatalogSummary["tracks"];
  let previews: Previews | undefined;
  let thumbnail: string | undefined;
  try {
    const samples = await sampleRecording(reader);
    tracks = samples.tracks;
    previews = await renderPreviews(samples.frames, start);
    // Cameras come busiest first; the middle frame of the first tends to show more than its first.
    const frames = previews[Object.keys(previews)[0] ?? ""];
    thumbnail = frames?.[Math.floor(frames.length / 2)]?.url;
  } catch (err: unknown) {
    console.warn("Catalog sampling failed", err);
  }

  return {
    previews: previews && Object.keys(previews).length > 0 ? previews : undefined,
    previewTopics: previews && Object.keys(previews).length > 0 ? Object.keys(previews) : undefined,
    thumbnail,
    tracks: tracks && tracks.length > 0 ? tracks : undefined,
    start: start == undefined ? undefined : fromNanoSec(start),
    end: end == undefined ? undefined : fromNanoSec(end),
    messages: reader.statistics == undefined ? undefined : Number(reader.statistics.messageCount),
    topics: [...topics.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
