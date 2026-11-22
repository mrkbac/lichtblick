// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Perf budget cases, bundled for Node by rspack.perf.config.ts and run by ci/perf-budget.ts against
// the same file built from the merge base. Every metric is "lower is better"; the unit in
// parentheses picks the budget (see ci/perf-budget.ts).

import { parse as parseRosmsg } from "@foxglove/rosmsg";
import { MessageWriter as Ros1Writer } from "@foxglove/rosmsg-serialization";
import { MessageWriter as Ros2Writer } from "@foxglove/rosmsg2-serialization";
import { Encoder as CborEncoder } from "cbor-x";
import zlib from "node:zlib";
import { FileDescriptorSet } from "protobufjs/ext/descriptor";

import { McapWriter, TempBuffer } from "@lichtblick/mcap-core";
import { parseChannel } from "@lichtblick/mcap-support";
import { Transform } from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms/Transform";
import { TransformTree } from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms/TransformTree";
import { McapIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/McapIterableSource";

export type Metrics = Record<string, number>;

/** Deterministic PRNG (mulberry32) so both builds see identical inputs */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCHEMA = `uint32 seq
float64 x
float64 y
float64 z
string frame_id
float32[] values
Point[] points
================================================================================
MSG: bench_msgs/Point
float64 x
float64 y
float64 z`;

function sampleMessage(i: number, random: () => number) {
  return {
    seq: i,
    x: random(),
    y: random(),
    z: random(),
    frame_id: `frame_${i % 8}`,
    values: Float32Array.from({ length: 64 }, () => random()),
    points: Array.from({ length: 32 }, () => ({ x: random(), y: random(), z: random() })),
  };
}

const SECONDS = 120;
/** [rate Hz, payload bytes]: small high-rate topics plus large scan-like blobs */
const TOPICS: [number, number][] = [
  [1000, 64],
  [200, 512],
  [100, 2_000],
  [50, 8_000],
  [10, 200_000],
  [10, 400_000],
];

/**
 * A synthetic zstd-chunked MCAP (~1.2 GB of messages, ~120 MB on disk). Payloads are repetitive with
 * random bytes mixed in so chunks compress like sensor data rather than to nothing.
 */
export async function generateMcap(): Promise<Uint8Array> {
  const random = rng(1);
  const tempBuffer = new TempBuffer();
  const writer = new McapWriter({
    writable: tempBuffer,
    chunkSize: 4 * 1024 * 1024,
    compressChunk: (data) => ({
      compression: "zstd",
      compressedData: zlib.zstdCompressSync(data, {
        params: { [zlib.constants.ZSTD_c_compressionLevel]: 1 },
      }),
    }),
  });
  await writer.start({ library: "perf-budget", profile: "" });
  const schemaId = await writer.registerSchema({
    name: "bench_msgs/Blob",
    encoding: "ros1msg",
    data: new TextEncoder().encode("uint8[] data"),
  });
  const channels: { id: number; rate: number; payload: Uint8Array }[] = [];
  for (const [index, [rate, size]] of TOPICS.entries()) {
    const payload = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      payload[i] = i % 16 === 0 ? Math.floor(random() * 256) : i & 0x3f;
    }
    const id = await writer.registerChannel({
      topic: `/bench/topic_${index}`,
      messageEncoding: "ros1",
      schemaId,
      metadata: new Map(),
    });
    channels.push({ id, rate, payload });
  }
  // Interleave by time, like a recorder
  const events: { time: bigint; channel: (typeof channels)[number] }[] = [];
  for (const channel of channels) {
    const periodNs = 1_000_000_000 / channel.rate;
    for (let t = 0; t < SECONDS * 1e9; t += periodNs) {
      events.push({ time: 1_000_000_000n + BigInt(Math.round(t)), channel });
    }
  }
  events.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  let sequence = 0;
  for (const { time, channel } of events) {
    // Vary a few bytes so identical messages don't collapse in the compressor
    channel.payload[0] = sequence & 0xff;
    await writer.addMessage({
      channelId: channel.id,
      sequence: sequence++,
      logTime: time,
      publishTime: time,
      data: channel.payload,
    });
  }
  await writer.end();
  return tempBuffer.get();
}

/** Wraps a Blob to count the bytes the source reads from it */
function countingBlob(blob: Blob): { file: Blob; bytesRead: () => number } {
  let bytes = 0;
  const file = {
    size: blob.size,
    slice(start?: number, end?: number) {
      const part = blob.slice(start, end);
      bytes += part.size;
      return part;
    },
    stream() {
      bytes += blob.size;
      return blob.stream();
    },
  };
  return { file: file as Blob, bytesRead: () => bytes };
}

type SourceCtx = {
  source: McapIterableSource;
  bytesRead: () => number;
  topics: Map<string, { topic: string }>;
  start: { sec: number; nsec: number };
  end: { sec: number; nsec: number };
};

async function openSource(blob: Blob): Promise<SourceCtx & { ttfmMs: number }> {
  const { file, bytesRead } = countingBlob(blob);
  const t0 = performance.now();
  const source = new McapIterableSource({ type: "file", file });
  const init = await source.initialize();
  const topics = new Map(init.topics.map((t) => [t.name, { topic: t.name }]));
  const iterator = source.messageIterator({ topics, consumptionType: "partial" });
  for await (const result of iterator) {
    if (result.type === "message-event") {
      break;
    }
  }
  await iterator.return?.();
  const ttfmMs = performance.now() - t0;
  return { source, bytesRead, topics, start: init.start, end: init.end, ttfmMs };
}

function heapBytes(): number {
  const { heapUsed, arrayBuffers } = process.memoryUsage();
  return heapUsed + arrayBuffers;
}

export const cases: Record<string, (ctx: { mcap: Blob }) => Promise<Metrics>> = {
  "mcap open": async ({ mcap }) => {
    const { source, bytesRead, ttfmMs } = await openSource(mcap);
    const opened = bytesRead();
    await source.terminate();
    return {
      "time to first message (ms)": ttfmMs,
      "bytes read to first message (bytes)": opened,
    };
  },

  "mcap full pass": async ({ mcap }) => {
    const { source, bytesRead, topics } = await openSource(mcap);
    const before = bytesRead();
    let peak = heapBytes();
    let count = 0;
    const t0 = performance.now();
    for await (const result of source.messageIterator({ topics, consumptionType: "full" })) {
      if (result.type === "message-event" && ++count % 2000 === 0) {
        peak = Math.max(peak, heapBytes());
      }
    }
    const ms = performance.now() - t0;
    const read = bytesRead() - before;
    await source.terminate();
    return {
      "full pass (ms)": ms,
      "full pass bytes read (bytes)": read,
      // Only meaningful in a fresh process; ci/perf-budget.ts measures it there
      "full pass peak heap (heap)": peak,
    };
  },

  "mcap seek": async ({ mcap }) => {
    const { source, bytesRead, topics, start, end } = await openSource(mcap);
    const random = rng(2);
    const startNs = start.sec * 1e9 + start.nsec;
    const spanNs = end.sec * 1e9 + end.nsec - startNs;
    const SEEKS = 10;
    const before = bytesRead();
    const t0 = performance.now();
    for (let i = 0; i < SEEKS; i++) {
      const ns = startNs + Math.floor(random() * spanNs);
      const time = { sec: Math.floor(ns / 1e9), nsec: ns % 1e9 };
      await source.getBackfillMessages({ topics, time });
      const iterator = source.messageIterator({ topics, start: time, consumptionType: "partial" });
      let n = 0;
      for await (const result of iterator) {
        if (result.type === "message-event" && ++n === 100) {
          break;
        }
      }
      await iterator.return?.();
    }
    const ms = (performance.now() - t0) / SEEKS;
    const read = (bytesRead() - before) / SEEKS;
    await source.terminate();
    return { "seek + backfill (ms)": ms, "seek bytes read (bytes)": read };
  },

  decode: async () => {
    const random = rng(3);
    const messages = Array.from({ length: 500 }, (_, i) => sampleMessage(i, random));
    const ros1Defs = parseRosmsg(SCHEMA);
    const ros2Defs = parseRosmsg(SCHEMA, { ros2: true });
    const schemaData = new TextEncoder().encode(SCHEMA);
    const fds = FileDescriptorSet.encode(FileDescriptorSet.root.toDescriptor("proto3")).finish();
    const cbor = new CborEncoder({ useRecords: false });
    const textEncoder = new TextEncoder();
    const inputs: [string, Parameters<typeof parseChannel>[0], Uint8Array[]][] = [
      [
        "ros1",
        {
          messageEncoding: "ros1",
          schema: { name: "bench_msgs/Sample", encoding: "ros1msg", data: schemaData },
        },
        messages.map((m) => new Ros1Writer(ros1Defs).writeMessage(m)),
      ],
      [
        "cdr",
        {
          messageEncoding: "cdr",
          schema: { name: "bench_msgs/msg/Sample", encoding: "ros2msg", data: schemaData },
        },
        messages.map((m) => new Ros2Writer(ros2Defs).writeMessage(m)),
      ],
      [
        "protobuf",
        {
          messageEncoding: "protobuf",
          schema: { name: "google.protobuf.FileDescriptorSet", encoding: "protobuf", data: fds },
        },
        messages.map(() => fds),
      ],
      [
        "json",
        { messageEncoding: "json", schema: undefined },
        messages.map((m) => textEncoder.encode(JSON.stringify({ ...m, values: [...m.values] }))),
      ],
      [
        "cbor",
        { messageEncoding: "cbor", schema: undefined },
        messages.map((m) => cbor.encode({ ...m, values: [...m.values] }) as Uint8Array),
      ],
    ];
    const metrics: Metrics = {};
    for (const [name, channel, data] of inputs) {
      const { deserialize } = parseChannel(channel);
      const pass = () => {
        for (const bytes of data) {
          deserialize(bytes);
        }
      };
      // Warm up, then time whole passes for at least 200 ms
      pass();
      pass();
      let passes = 0;
      const t0 = performance.now();
      while (passes < 3 || performance.now() - t0 < 200) {
        pass();
        passes++;
      }
      metrics[`decode ${name} (us/msg)`] =
        ((performance.now() - t0) * 1000) / (passes * data.length);
    }
    return metrics;
  },

  transforms: async () => {
    const random = rng(4);
    const tree = new TransformTree();
    const FRAMES = 20;
    const SAMPLES = 1000;
    const t0 = performance.now();
    for (let s = 0; s < SAMPLES; s++) {
      const time = BigInt(s) * 10_000_000n;
      for (let f = 1; f < FRAMES; f++) {
        const transform = new Transform(
          [random(), random(), random()],
          [0, 0, Math.sin(s / 100), Math.cos(s / 100)],
        );
        tree.addTransform(`f${f}`, `f${f - 1}`, time, transform);
      }
    }
    const addUs = ((performance.now() - t0) * 1000) / (SAMPLES * (FRAMES - 1));
    const LOOKUPS = 50_000;
    const pose = { position: { x: 1, y: 2, z: 3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
    const output = {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    };
    const t1 = performance.now();
    for (let i = 0; i < LOOKUPS; i++) {
      const time = BigInt(Math.floor(random() * SAMPLES * 10_000_000));
      tree.apply(output, pose, "f0", undefined, `f${FRAMES - 1}`, time, time);
    }
    const lookupUs = ((performance.now() - t1) * 1000) / LOOKUPS;
    return { "transform add (us/op)": addUs, "transform lookup, 20 frames (us/op)": lookupUs };
  },
};
