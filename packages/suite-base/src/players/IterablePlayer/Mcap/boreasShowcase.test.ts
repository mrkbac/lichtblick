// SPDX-License-Identifier: MPL-2.0

// Conformance test: the Boreas showcase recording (ci/create-boreas-showcase.py) uses every
// schema encoding, message encoding and MCAP container feature Lichtblick reads. It is read here
// the way the app reads it, indexed and streaming, and compared with what the converter wrote
// (ci/boreas-showcase.expect.json). A codec regression fails with the topic and encoding named.
//
// The recording comes from BOREAS_SHOWCASE_MCAP (a local path), else it is downloaded once from
// the expectations' URL into a cache keyed by its SHA-256. Without either, the test is skipped.

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BlobReadable, McapIndexedReader, McapStreamReader } from "@lichtblick/mcap-core";
import { loadDecompressHandlers } from "@lichtblick/mcap-support";
import { DeserializingIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/DeserializingIterableSource";
import { IIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";
import { McapIndexedIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/McapIndexedIterableSource";
import { McapUnindexedIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/McapUnindexedIterableSource";

type Scalar = string | number | boolean;
type ChannelExpectation = {
  topic: string;
  schema_name: string;
  schema_encoding: string;
  message_encoding: string;
  count: number;
  indexed_count: number;
  first_log_time: string;
  last_log_time: string;
  first_sha256: string;
  fields: Record<string, Scalar>;
};
type Expectations = {
  file: { url: string; sha256: string; size: number };
  container: {
    chunk_count: number;
    chunk_compressions: string[];
    chunks_without_crc: number;
    chunks_without_message_index: number;
    empty_chunks: number;
    out_of_order_chunks: number;
    overlapping_chunks: boolean;
    unchunked_messages: number;
    attachments: string[];
    metadata: string[];
    message_count: number;
  };
  channels: ChannelExpectation[];
};

const repoRoot = path.resolve(__dirname, "../../../../../..");
const expectationsPath =
  process.env.BOREAS_SHOWCASE_EXPECT ?? path.join(repoRoot, "ci/boreas-showcase.expect.json");
const expectations = JSON.parse(fs.readFileSync(expectationsPath, "utf8")) as Expectations;

async function recordingPath(): Promise<string | undefined> {
  if (process.env.BOREAS_SHOWCASE_MCAP) {
    return process.env.BOREAS_SHOWCASE_MCAP;
  }
  const { url, sha256 } = expectations.file;
  if (!url) {
    return undefined;
  }
  const cached = path.join(os.tmpdir(), "lichtblick-boreas", `${sha256}.mcap`);
  if (!fs.existsSync(cached)) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Downloading ${url} failed: ${response.status}`);
    }
    const data = new Uint8Array(await response.arrayBuffer());
    const actual = createHash("sha256").update(data).digest("hex");
    if (actual !== sha256) {
      throw new Error(`${url} has SHA-256 ${actual}, expected ${sha256}`);
    }
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(`${cached}.part`, data);
    fs.renameSync(`${cached}.part`, cached);
  }
  return cached;
}

const file = await recordingPath();

/** Walks a path like `status[0].values[0].key` into a decoded message. */
function at(message: unknown, fieldPath: string): unknown {
  let value = message;
  for (const part of fieldPath.split(/\.|\[(\d+)\]/).filter(Boolean)) {
    value = (value as Record<string, unknown> | undefined)?.[part];
  }
  return typeof value === "bigint" ? Number(value) : value;
}

/** The expected value where the decoded one matches it (floats to 1e-6 relative), else the decoded one. */
function decodedFields(
  message: unknown,
  expected: Record<string, Scalar>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(expected).map(([fieldPath, want]) => {
      const got = at(message, fieldPath);
      const close =
        typeof want === "number" &&
        typeof got === "number" &&
        Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want));
      return [fieldPath, close ? want : got];
    }),
  );
}

function label(channel: ChannelExpectation): string {
  return `${channel.topic} (${channel.schema_encoding || "no schema"} ${channel.schema_name} / ${channel.message_encoding})`;
}

/** Every message of every topic through the app's deserializing source, by topic. */
async function readAll(
  source: IIterableSource<Uint8Array>,
): Promise<Map<string, { count: number; first: unknown; errors: string[] }>> {
  const deserializing = new DeserializingIterableSource(source);
  const init = await deserializing.initialize();
  const byTopic = new Map<string, { count: number; first: unknown; errors: string[] }>();
  for (const topic of init.topics) {
    byTopic.set(topic.name, { count: 0, first: undefined, errors: [] });
  }
  for await (const result of deserializing.messageIterator({
    topics: new Map(init.topics.map((topic) => [topic.name, { topic: topic.name }])),
  })) {
    if (result.type === "message-event") {
      const entry = byTopic.get(result.msgEvent.topic)!;
      entry.first ??= result.msgEvent.message;
      entry.count += 1;
    } else if (result.type === "alert") {
      const topic = init.topics.find((t) => result.alert.message.includes(t.name))?.name;
      byTopic.get(topic ?? "")?.errors.push(result.alert.message);
    }
  }
  return byTopic;
}

describe.skipIf(file == undefined)("Boreas showcase recording", () => {
  const blob = async () => await fs.openAsBlob(file!);

  it("has the container features the converter wrote", async () => {
    const reader = await McapIndexedReader.Initialize({
      readable: new BlobReadable(await blob()),
      decompressHandlers: await loadDecompressHandlers(),
    });
    const { container } = expectations;
    const chunks = reader.chunkIndexes;
    expect(chunks.length).toBe(container.chunk_count);
    expect([...new Set(chunks.map((c) => c.compression))].sort()).toEqual(
      container.chunk_compressions,
    );
    expect(chunks.filter((c) => c.messageIndexOffsets.size === 0).length).toBe(
      container.chunks_without_message_index + container.empty_chunks,
    );
    expect(reader.statistics?.messageCount).toBe(BigInt(container.message_count));
    expect(reader.dataSectionCrc).not.toBe(0);

    const attachments = [];
    for await (const attachment of reader.readAttachments()) {
      attachments.push(attachment.name);
    }
    expect(attachments).toEqual(container.attachments);
    const metadata = [];
    for await (const record of reader.readMetadata()) {
      metadata.push(record.name);
    }
    expect(metadata).toEqual(container.metadata);

    // The first message of each channel, byte for byte.
    const firstHash = new Map<string, string>();
    for await (const message of reader.readMessages()) {
      const topic = reader.channelsById.get(message.channelId)!.topic;
      if (!firstHash.has(topic)) {
        firstHash.set(topic, createHash("sha256").update(message.data).digest("hex"));
      }
    }
    // Channels with unchunked messages may start outside the index.
    const indexed = expectations.channels.filter((c) => c.indexed_count === c.count);
    expect(Object.fromEntries(indexed.map((c) => [c.topic, firstHash.get(c.topic)]))).toEqual(
      Object.fromEntries(indexed.map((c) => [c.topic, c.first_sha256])),
    );
  }, 300_000);

  it("streams every record, CRCs checked, in the order written", async () => {
    const reader = new McapStreamReader({
      decompressHandlers: await loadDecompressHandlers(),
      includeChunks: true,
      validateCrcs: true,
    });
    const topics = new Map<number, string>();
    const counts = new Map<string, number>();
    let chunks = 0;
    let unchunked = 0;
    let inChunk = 0;
    let outOfOrder = 0;
    let lastInChunk = 0n;
    for await (const piece of (await blob()).stream()) {
      reader.append(piece);
      for (let record; (record = reader.nextRecord()); ) {
        if (record.type === "Chunk") {
          chunks += 1;
          inChunk = Number(record.uncompressedSize);
          lastInChunk = 0n;
        } else if (record.type === "Channel") {
          topics.set(record.id, record.topic);
        } else if (record.type === "Message") {
          const topic = topics.get(record.channelId)!;
          counts.set(topic, (counts.get(topic) ?? 0) + 1);
          if (inChunk === 0) {
            unchunked += 1;
          } else {
            outOfOrder += record.logTime < lastInChunk ? 1 : 0;
            lastInChunk = record.logTime;
          }
        } else if (record.type === "MessageIndex" || record.type === "DataEnd") {
          inChunk = 0;
        }
      }
    }
    expect(reader.done()).toBe(true);
    expect(chunks).toBe(expectations.container.chunk_count);
    expect(unchunked).toBe(expectations.container.unchunked_messages);
    expect(outOfOrder > 0).toBe(expectations.container.out_of_order_chunks > 0);
    for (const channel of expectations.channels) {
      expect({ topic: channel.topic, count: counts.get(channel.topic) }).toEqual({
        topic: channel.topic,
        count: channel.count,
      });
    }
  }, 300_000);

  it.each([
    ["indexed", "indexed_count"],
    ["unindexed", "count"],
  ] as const)(
    "decodes every message of every topic in the %s source",
    async (kind, countKey) => {
      const source =
        kind === "indexed"
          ? new McapIndexedIterableSource(
              await McapIndexedReader.Initialize({
                readable: new BlobReadable(await blob()),
                decompressHandlers: await loadDecompressHandlers(),
              }),
            )
          : new McapUnindexedIterableSource({
              size: (await blob()).size,
              stream: (await blob()).stream(),
            });
      const byTopic = await readAll(source);
      for (const channel of expectations.channels) {
        const read = byTopic.get(channel.topic);
        expect({
          channel: label(channel),
          errors: read?.errors,
          count: read?.count,
          fields: decodedFields(read?.first, channel.fields),
        }).toEqual({
          channel: label(channel),
          errors: [],
          count: channel[countKey],
          fields: channel.fields,
        });
      }
    },
    600_000,
  );
});
