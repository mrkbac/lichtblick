// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapIndexedReader, McapTypes } from "@mcap/core";
import * as _ from "lodash-es";

import { parseChannel } from "@lichtblick/mcap-support";
import { NavSatFixMsg } from "@lichtblick/suite-base/panels/Map/types";

import { CompressedFrame, isCompressedImageSchema, toFrame } from "./thumbnail";
import { isFixSchema, toPoint } from "./track";
import { CatalogTrack } from "./types";

/**
 * One sample per this much recording time, so every clip plays at the same speed-up and the
 * preview's seek steps mean the same time in every recording. Each sample yields one GPS fix and
 * one frame per camera and decompresses its chunk, so the bounds below, not the recording's size,
 * bound the cost.
 */
const SAMPLE_INTERVAL_SEC = 2;
const MIN_SAMPLES = 8;
/** Past 4 minutes samples spread out instead, keeping long recordings cheap to index. */
const MAX_SAMPLES = 120;

/** Samples for a recording of `durationSec`: one per SAMPLE_INTERVAL_SEC, within bounds. */
export function sampleCount(durationSec: number): number {
  const count = Math.round(durationSec / SAMPLE_INTERVAL_SEC);
  return Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Number.isFinite(count) ? count : MIN_SAMPLES));
}
/**
 * Cameras sampled while indexing; each multiplies the image decoding. The busiest are taken, which
 * skips low rate copies such as throttled streams. Others are sampled when picked in the preview.
 */
const MAX_IMAGE_TOPICS = 2;

export type SampledFrame = { logTime: bigint; frame: CompressedFrame };

export type Samples = {
  tracks: CatalogTrack[];
  /** Frames per image topic, in time order. */
  frames: Map<string, SampledFrame[]>;
};

/**
 * Up to `count` chunks spread evenly over the chunks holding any of `channelIds`. When the evenly
 * spaced chunk lacks some channels, a neighbor within half the spacing that has more of them is
 * taken instead, so GPS and camera samples come from the same chunk where possible.
 */
export function pickChunks(
  chunkIndexes: readonly McapTypes.ChunkIndex[],
  channelIds: readonly number[],
  count: number,
): McapTypes.ChunkIndex[] {
  const coverage = (chunk: McapTypes.ChunkIndex) =>
    channelIds.filter((id) => chunk.messageIndexOffsets.has(id)).length;
  const chunks = chunkIndexes
    .filter((chunk) => coverage(chunk) > 0)
    .sort((a, b) => (a.messageStartTime < b.messageStartTime ? -1 : 1));
  const n = Math.min(count, chunks.length);
  if (n === 0) {
    return [];
  }
  const spacing = chunks.length / n;
  const radius = Math.floor(spacing / 2);
  const picked = Array.from({ length: n }, (_unused, i) => {
    const target = Math.floor(i * spacing);
    let best = target;
    // Nearest first, so the sample stays as close to even spacing as it can.
    for (let d = 1; d <= radius && coverage(chunks[best]!) < channelIds.length; d++) {
      for (const candidate of [target + d, target - d]) {
        const chunk = chunks[candidate];
        if (chunk && coverage(chunk) > coverage(chunks[best]!)) {
          best = candidate;
        }
      }
    }
    return best;
  });
  return _.uniq(picked).map((i) => chunks[i]!);
}

/**
 * Sample GPS fixes and camera frames in one pass: every picked chunk is decompressed once and
 * yields the first valid fix per GPS topic and the first frame per image topic.
 */
export async function sampleRecording(
  reader: McapIndexedReader,
  { imageTopics, count }: { imageTopics?: readonly string[]; count?: number } = {},
): Promise<Samples> {
  const schemaName = (schemaId: number) => reader.schemasById.get(schemaId)?.name ?? "";
  const all = [...reader.channelsById.values()];
  const gpsChannels = all.filter((c) => isFixSchema(schemaName(c.schemaId)));
  const counts = reader.statistics?.channelMessageCounts;
  const busiest = new Map<string, number>();
  for (const c of all.filter((ch) => isCompressedImageSchema(schemaName(ch.schemaId)))) {
    busiest.set(c.topic, (busiest.get(c.topic) ?? 0) + Number(counts?.get(c.id) ?? 0n));
  }
  const cameraTopics =
    imageTopics ??
    _.orderBy([...busiest], [([, messages]) => messages, ([topic]) => topic], ["desc", "asc"])
      .slice(0, MAX_IMAGE_TOPICS)
      .map(([topic]) => topic);
  const imageChannels = all.filter((c) => cameraTopics.includes(c.topic));
  const channels = [...gpsChannels, ...imageChannels];

  const gpsTopics = new Set(gpsChannels.map((c) => c.topic));
  const topics = _.uniq(channels.map((c) => c.topic));
  const deserializers = new Map(
    channels.map((c) => [
      c.id,
      parseChannel({
        messageEncoding: c.messageEncoding,
        schema: reader.schemasById.get(c.schemaId),
      }).deserialize,
    ]),
  );
  const points = new Map<string, [number, number][]>([...gpsTopics].map((t) => [t, []]));
  const frames = new Map<string, SampledFrame[]>(cameraTopics.map((t) => [t, []]));

  const channelIds = channels.map((c) => c.id);
  const relevant = reader.chunkIndexes.filter((chunk) =>
    channelIds.some((id) => chunk.messageIndexOffsets.has(id)),
  );
  const startNs = _.min(relevant.map((chunk) => chunk.messageStartTime)) ?? 0n;
  const endNs = _.max(relevant.map((chunk) => chunk.messageEndTime)) ?? 0n;
  const chunks = pickChunks(
    relevant,
    channelIds,
    count ?? sampleCount(Number(endNs - startNs) / 1e9),
  );
  for (const chunk of chunks) {
    const done = new Set<string>();
    for await (const message of reader.readMessages({
      topics,
      startingAt: chunk.messageStartTime,
      endingAt: chunk.messageEndTime,
    })) {
      const topic = reader.channelsById.get(message.channelId)!.topic;
      if (done.has(topic)) {
        continue;
      }
      const decoded = deserializers.get(message.channelId)!(message.data);
      if (gpsTopics.has(topic)) {
        const point = toPoint(decoded as Partial<NavSatFixMsg>);
        if (!point) {
          continue; // a later fix in this chunk may be valid
        }
        const track = points.get(topic)!;
        const last = track[track.length - 1];
        if (last?.[0] !== point[0] || last[1] !== point[1]) {
          track.push(point);
        }
      } else {
        const frame = toFrame(decoded);
        if (!frame) {
          continue;
        }
        frames.get(topic)!.push({ logTime: message.logTime, frame });
      }
      done.add(topic);
      if (done.size === topics.length) {
        break;
      }
    }
  }

  const tracks = [...points]
    .map(([topic, trackPoints]) => ({ topic, points: trackPoints }))
    .filter((track) => track.points.length > 0)
    .sort((a, b) => a.topic.localeCompare(b.topic));
  return { tracks, frames };
}
