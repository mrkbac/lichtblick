// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapIndexedReader } from "@mcap/core";
import * as _ from "lodash-es";

import { parseChannel } from "@lichtblick/mcap-support";
import { isGeoJSONSchema, isSupportedSchema } from "@lichtblick/suite-base/panels/Map/support";
import { NavSatFixMsg, NavSatFixStatus } from "@lichtblick/suite-base/panels/Map/types";

import { CatalogTrack } from "./types";

/**
 * Chunks to sample, one fix each. Enough to tell routes apart, not to measure them. Reading a fix
 * means decompressing its whole chunk, so this, not the recording's length, bounds the cost.
 */
const SAMPLES = 100;
/** ~1 m; finer digits only make the cache bigger. */
const DECIMALS = 5;

function isFixSchema(name: string): boolean {
  return isSupportedSchema(name) && !isGeoJSONSchema(name);
}

function round(value: number): number {
  return Number(value.toFixed(DECIMALS));
}

function toPoint(fix: Partial<NavSatFixMsg>): [number, number] | undefined {
  const { latitude: lat, longitude: lon } = fix;
  if (
    lat == undefined ||
    lon == undefined ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180 ||
    (lat === 0 && lon === 0) ||
    fix.status?.status === NavSatFixStatus.STATUS_NO_FIX
  ) {
    return undefined;
  }
  return [round(lon), round(lat)];
}

/**
 * Read one fix per GPS topic from up to SAMPLES chunks spread evenly over the recording. Chunks
 * without a valid fix are skipped, so a receiver that only gets a fix late still yields a (shorter)
 * track.
 */
export async function readTracks(reader: McapIndexedReader): Promise<CatalogTrack[]> {
  const channels = [...reader.channelsById.values()].filter((c) =>
    isFixSchema(reader.schemasById.get(c.schemaId)?.name ?? ""),
  );
  if (channels.length === 0) {
    return [];
  }
  const deserializers = new Map(
    channels.map((c) => [
      c.id,
      parseChannel({
        messageEncoding: c.messageEncoding,
        schema: reader.schemasById.get(c.schemaId),
      }).deserialize,
    ]),
  );
  const topics = [...new Set(channels.map((c) => c.topic))];
  const points = new Map<string, [number, number][]>(topics.map((topic) => [topic, []]));

  const chunks = reader.chunkIndexes
    .filter((chunk) => channels.some((c) => chunk.messageIndexOffsets.has(c.id)))
    .sort((a, b) => (a.messageStartTime < b.messageStartTime ? -1 : 1));
  const picked = _.uniq(
    Array.from({ length: Math.min(SAMPLES, chunks.length) }, (_unused, i) =>
      Math.floor((i * chunks.length) / Math.min(SAMPLES, chunks.length)),
    ),
  ).map((i) => chunks[i]!);

  for (const chunk of picked) {
    const from = chunk.messageStartTime;
    const to = chunk.messageEndTime;
    const sampled = new Set<string>();
    for await (const message of reader.readMessages({ topics, startTime: from, endTime: to })) {
      const channel = reader.channelsById.get(message.channelId)!;
      if (sampled.has(channel.topic)) {
        continue;
      }
      const point = toPoint(deserializers.get(channel.id)!(message.data) as Partial<NavSatFixMsg>);
      if (!point) {
        continue;
      }
      sampled.add(channel.topic);
      const track = points.get(channel.topic)!;
      const last = track[track.length - 1];
      if (last?.[0] !== point[0] || last[1] !== point[1]) {
        track.push(point);
      }
      if (sampled.size === topics.length) {
        break;
      }
    }
  }

  return topics
    .map((topic) => ({ topic, points: points.get(topic)! }))
    .filter((track) => track.points.length > 0)
    .sort((a, b) => a.topic.localeCompare(b.topic));
}

export type Bounds = [west: number, south: number, east: number, north: number];

export function trackBounds(points: readonly [number, number][]): Bounds | undefined {
  if (points.length === 0) {
    return undefined;
  }
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** The track for `topic`, or the first track when no topic is chosen or the recording lacks it. */
export function pickTrack(
  tracks: readonly CatalogTrack[] | undefined,
  topic: string | undefined,
): CatalogTrack | undefined {
  return tracks?.find((t) => t.topic === topic) ?? tracks?.[0];
}
