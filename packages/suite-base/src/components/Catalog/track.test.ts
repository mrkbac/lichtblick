// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapIndexedReader, McapWriter, TempBuffer } from "@mcap/core";

import { loadDecompressHandlers } from "@lichtblick/mcap-support";
import { BlobReadable } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/BlobReadable";

import { boundsIntersect, pickTrack, readTracks, trackBounds } from "./track";

const SEC = 1_000_000_000n;

type Fix = { latitude: number; longitude: number; status?: { status: number } };

async function readerFor(topics: Record<string, Fix[]>): Promise<McapIndexedReader> {
  const buffer = new TempBuffer();
  const writer = new McapWriter({ writable: buffer, chunkSize: 1 });
  await writer.start({ library: "", profile: "" });
  const schemaId = await writer.registerSchema({
    name: "sensor_msgs/msg/NavSatFix",
    encoding: "jsonschema",
    data: new TextEncoder().encode(JSON.stringify({ type: "object" })),
  });
  for (const [topic, fixes] of Object.entries(topics)) {
    const channelId = await writer.registerChannel({
      topic,
      schemaId,
      messageEncoding: "json",
      metadata: new Map(),
    });
    for (const [i, fix] of fixes.entries()) {
      await writer.addMessage({
        channelId,
        sequence: i,
        logTime: BigInt(i) * SEC,
        publishTime: BigInt(i) * SEC,
        data: new TextEncoder().encode(JSON.stringify(fix)),
      });
    }
  }
  await writer.end();
  return await McapIndexedReader.Initialize({
    readable: new BlobReadable(new Blob([new Uint8Array(buffer.get())])),
    decompressHandlers: await loadDecompressHandlers(),
  });
}

describe("readTracks", () => {
  it("samples fixes per topic, skipping invalid and repeated ones", async () => {
    const fix = (latitude: number, longitude: number, status = 0): Fix => ({
      latitude,
      longitude,
      status: { status },
    });
    const reader = await readerFor({
      "/gps": [
        fix(48.1, 11.5),
        fix(0, 0),
        fix(48.2, 11.6, -1),
        fix(48.3, 11.7),
        fix(48.3, 11.7),
        fix(Number.NaN, 11.8),
        fix(48.123456789, 11.9),
      ],
      "/b_gps": [fix(52.5, 13.4)],
    });
    const tracks = await readTracks(reader);
    expect(tracks).toEqual([
      { topic: "/b_gps", points: [[13.4, 52.5]] },
      {
        topic: "/gps",
        points: [
          [11.5, 48.1],
          [11.7, 48.3],
          [11.9, 48.12346],
        ],
      },
    ]);
  });

  it("reads at most one chunk per sample", async () => {
    const fixes = Array.from({ length: 300 }, (_unused, i) => ({
      latitude: 48 + i / 1000,
      longitude: 11,
    }));
    const reader = await readerFor({ "/gps": fixes });
    const [track] = await readTracks(reader);
    expect(track!.points).toHaveLength(100);
    expect(track!.points[0]).toEqual([11, 48]);
  });
});

describe("track helpers", () => {
  it("computes and intersects bounds", () => {
    const bounds = trackBounds([
      [11, 48],
      [12, 47],
    ]);
    expect(bounds).toEqual([11, 47, 12, 48]);
    expect(boundsIntersect(bounds!, [11.5, 47.5, 13, 49])).toBe(true);
    expect(boundsIntersect(bounds!, [12.5, 47.5, 13, 49])).toBe(false);
  });

  it("picks the chosen topic, else the first track", () => {
    const tracks = [
      { topic: "/a", points: [] },
      { topic: "/b", points: [] },
    ];
    expect(pickTrack(tracks, "/b")?.topic).toBe("/b");
    expect(pickTrack(tracks, "/missing")?.topic).toBe("/a");
    expect(pickTrack(tracks, undefined)?.topic).toBe("/a");
  });
});
