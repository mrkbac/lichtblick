// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapIndexedReader, McapTypes, McapWriter, TempBuffer } from "@mcap/core";

import { loadDecompressHandlers } from "@lichtblick/mcap-support";
import { BlobReadable } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/BlobReadable";

import { pickChunks, sampleRecording } from "./sampleRecording";

const SEC = 1_000_000_000n;

const IMAGE_SCHEMA = {
  type: "object",
  properties: {
    format: { type: "string" },
    data: { type: "string", contentEncoding: "base64" },
  },
};

type Fix = { latitude: number; longitude: number; status?: { status: number } };
const fix = (latitude: number, longitude: number, status = 0): Fix => ({
  latitude,
  longitude,
  status: { status },
});
const image = (format: string) => ({ format, data: "AQI=" });

/** One message per chunk; each message is [topic, logTime in s, payload]. */
async function readerFor(
  messages: [topic: string, sec: number, payload: unknown][],
): Promise<McapIndexedReader> {
  const buffer = new TempBuffer();
  const writer = new McapWriter({ writable: buffer, chunkSize: 1 });
  await writer.start({ library: "", profile: "" });
  const schemas = {
    fix: await writer.registerSchema({
      name: "sensor_msgs/msg/NavSatFix",
      encoding: "jsonschema",
      data: new TextEncoder().encode(JSON.stringify({ type: "object" })),
    }),
    image: await writer.registerSchema({
      name: "foxglove.CompressedImage",
      encoding: "jsonschema",
      data: new TextEncoder().encode(JSON.stringify(IMAGE_SCHEMA)),
    }),
  };
  const channels = new Map<string, number>();
  for (const [i, [topic, sec, payload]] of messages.entries()) {
    let channelId = channels.get(topic);
    if (channelId == undefined) {
      channelId = await writer.registerChannel({
        topic,
        schemaId: topic.includes("gps") ? schemas.fix : schemas.image,
        messageEncoding: "json",
        metadata: new Map(),
      });
      channels.set(topic, channelId);
    }
    await writer.addMessage({
      channelId,
      sequence: i,
      logTime: BigInt(sec) * SEC,
      publishTime: BigInt(sec) * SEC,
      data: new TextEncoder().encode(JSON.stringify(payload)),
    });
  }
  await writer.end();
  return await McapIndexedReader.Initialize({
    readable: new BlobReadable(new Blob([new Uint8Array(buffer.get())])),
    decompressHandlers: await loadDecompressHandlers(),
  });
}

describe("sampleRecording", () => {
  it("reads GPS tracks, skipping invalid and repeated fixes", async () => {
    const reader = await readerFor([
      ["/gps", 0, fix(48.1, 11.5)],
      ["/gps", 1, fix(0, 0)],
      ["/gps", 2, fix(48.2, 11.6, -1)],
      ["/gps", 3, fix(48.3, 11.7)],
      ["/gps", 4, fix(48.3, 11.7)],
      ["/gps", 5, fix(Number.NaN, 11.8)],
      ["/gps", 6, fix(48.123456789, 11.9)],
      ["/b_gps", 7, fix(52.5, 13.4)],
    ]);
    const { tracks } = await sampleRecording(reader);
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

  it("spreads frames of every camera evenly over the recording", async () => {
    const messages: [string, number, unknown][] = [];
    for (let i = 0; i < 100; i++) {
      messages.push(["/front", i, image(`front-${i}`)], ["/rear", i, image(`rear-${i}`)]);
    }
    const { frames } = await sampleRecording(await readerFor(messages), { count: 4 });
    expect(frames.get("/front")!.map((f) => f.frame.format)).toEqual([
      "front-0",
      "front-25",
      "front-50",
      "front-75",
    ]);
    expect(frames.get("/rear")!.map((f) => f.logTime)).toEqual(
      [0n, 25n, 50n, 75n].map((s) => s * SEC),
    );
    expect(frames.get("/front")![0]!.frame.data).toEqual(new Uint8Array([1, 2]));
  });

  it("samples the two busiest cameras by default", async () => {
    const messages: [string, number, unknown][] = [];
    for (let i = 0; i < 6; i++) {
      messages.push(
        ["/a_slow", i, image("a")],
        ["/b_fast", i, image("b")],
        ["/c_fast", i, image("c")],
      );
      messages.push(["/b_fast", i, image("b")], ["/c_fast", i, image("c")]);
    }
    const { frames } = await sampleRecording(await readerFor(messages));
    expect([...frames.keys()]).toEqual(["/b_fast", "/c_fast"]);
  });

  it("samples only the asked-for image topics", async () => {
    const reader = await readerFor([
      ["/front", 0, image("front")],
      ["/rear", 1, image("rear")],
    ]);
    const { frames } = await sampleRecording(reader, { imageTopics: ["/rear"] });
    expect([...frames.keys()]).toEqual(["/rear"]);
  });
});

describe("pickChunks", () => {
  const chunk = (sec: number, channelIds: number[]) =>
    ({
      messageStartTime: BigInt(sec),
      messageEndTime: BigInt(sec),
      messageIndexOffsets: new Map(channelIds.map((id) => [id, 0n])),
    }) as McapTypes.ChunkIndex;

  it("spaces picks evenly", () => {
    const chunks = Array.from({ length: 12 }, (_unused, i) => chunk(i, [1]));
    expect(pickChunks(chunks, [1], 4).map((c) => c.messageStartTime)).toEqual([0n, 3n, 6n, 9n]);
  });

  it("moves a pick to a nearby chunk holding all wanted channels", () => {
    // GPS (2) only in every third chunk, camera (1) in all of them.
    const chunks = Array.from({ length: 12 }, (_unused, i) => chunk(i, i % 3 === 1 ? [1, 2] : [1]));
    expect(pickChunks(chunks, [1, 2], 4).map((c) => c.messageStartTime)).toEqual([1n, 4n, 7n, 10n]);
  });

  it("takes every chunk when there are fewer than asked for", () => {
    const chunks = [chunk(5, [1]), chunk(1, [1]), chunk(3, [2])];
    expect(pickChunks(chunks, [1, 2], 48).map((c) => c.messageStartTime)).toEqual([1n, 3n, 5n]);
  });
});
