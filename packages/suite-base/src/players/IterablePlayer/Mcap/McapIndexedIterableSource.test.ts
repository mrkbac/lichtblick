// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { McapIndexedReader, McapTypes, McapWriter, TempBuffer } from "@mcap/core";
import { Blob } from "node:buffer";

import { loadDecompressHandlers } from "@lichtblick/mcap-support";
import { BlobReadable } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/BlobReadable";
import { McapIndexedIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/McapIndexedIterableSource";

describe("McapIndexedIterableSource", () => {
  it("adds a channel whose schema was missing once a later initialize() finds it", async () => {
    // Given a reader whose channel's schema is missing at first
    const tempBuffer = new TempBuffer();
    const writer = new McapWriter({ writable: tempBuffer, startChannelId: 1 });
    await writer.start({ library: "", profile: "" });
    const schemaId = await writer.registerSchema({
      data: new TextEncoder().encode(JSON.stringify({ type: "object" })),
      encoding: "jsonschema",
      name: "example_schema",
    });
    await writer.registerChannel({
      messageEncoding: "json",
      schemaId,
      metadata: new Map(),
      topic: "/example",
    });
    await writer.addMessage({
      channelId: 1,
      data: new TextEncoder().encode("{}"),
      logTime: 0n,
      publishTime: 0n,
      sequence: 1,
    });
    await writer.end();
    const reader = await McapIndexedReader.Initialize({
      readable: new BlobReadable(new Blob([tempBuffer.get().slice()])),
      decompressHandlers: await loadDecompressHandlers(),
    });
    const schemas = reader.schemasById as unknown as Map<number, McapTypes.Schema>;
    const schema = schemas.get(schemaId)!;
    schemas.delete(schemaId);
    const source = new McapIndexedIterableSource(reader);
    const before = await source.initialize();

    // When the schema shows up (e.g. repeated in a later chunk of a growing index)
    schemas.set(schemaId, schema);
    const after = await source.initialize();

    // Then the channel is added and the alert is gone
    expect(before.topics).toEqual([]);
    expect(before.alerts[0]?.message).toMatch(/Missing schema info/);
    expect(after.topics.map((topic) => topic.name)).toEqual(["/example"]);
    expect(after.alerts).toEqual([]);
  });

  it("returns the correct metadata", async () => {
    const tempBuffer = new TempBuffer();

    const writer = new McapWriter({ writable: tempBuffer, startChannelId: 1 });
    await writer.start({ library: "", profile: "" });
    await writer.registerSchema({
      data: new Uint8Array(),
      encoding: "test",
      name: "test",
    });
    await writer.registerChannel({
      messageEncoding: "1",
      schemaId: 1,
      metadata: new Map(),
      topic: "test",
    });
    await writer.addMessage({
      channelId: 1,
      data: new Uint8Array(),
      logTime: 0n,
      publishTime: 0n,
      sequence: 1,
    });
    await writer.addMetadata({
      name: "metadata1",
      metadata: new Map(Object.entries({ key: "value" })),
    });
    await writer.end();

    const readable = new BlobReadable(new Blob([tempBuffer.get().slice()]));
    const decompressHandlers = await loadDecompressHandlers();
    const reader = await McapIndexedReader.Initialize({ readable, decompressHandlers });

    const source = new McapIndexedIterableSource(reader);

    const { metadata } = await source.initialize();

    expect(metadata).toBeDefined();
    expect(metadata).toEqual([
      {
        name: "metadata1",
        metadata: { key: "value" },
      },
    ]);
  });

  it("returns an empty array when no metadata is on the file", async () => {
    const tempBuffer = new TempBuffer();

    const writer = new McapWriter({ writable: tempBuffer, startChannelId: 1 });
    await writer.start({ library: "", profile: "" });
    await writer.registerSchema({
      data: new Uint8Array(),
      encoding: "test",
      name: "test",
    });
    await writer.registerChannel({
      messageEncoding: "1",
      schemaId: 1,
      metadata: new Map(),
      topic: "test",
    });
    await writer.addMessage({
      channelId: 1,
      data: new Uint8Array(),
      logTime: 0n,
      publishTime: 0n,
      sequence: 1,
    });
    await writer.end();

    const readable = new BlobReadable(new Blob([tempBuffer.get().slice()]));
    const decompressHandlers = await loadDecompressHandlers();
    const reader = await McapIndexedReader.Initialize({ readable, decompressHandlers });

    const source = new McapIndexedIterableSource(reader);

    const { metadata } = await source.initialize();

    expect(metadata).toBeDefined();
    expect(metadata).toEqual([]);
  });

  it("returns topicStats with numMessages and global start/end times separately", async () => {
    const tempBuffer = new TempBuffer();

    const writer = new McapWriter({
      writable: tempBuffer,
      startChannelId: 1,
      useStatistics: true, // Enable statistics so channelMessageCounts is populated
    });
    await writer.start({ library: "", profile: "" });
    await writer.registerSchema({
      data: new TextEncoder().encode("string data"),
      encoding: "ros1msg",
      name: "std_msgs/String",
    });
    await writer.registerChannel({
      messageEncoding: "ros1",
      schemaId: 1,
      metadata: new Map(),
      topic: "test",
    });
    // Add messages with specific timestamps
    await writer.addMessage({
      channelId: 1,
      data: new Uint8Array(),
      logTime: 1000000000n, // 1 second
      publishTime: 1000000000n,
      sequence: 1,
    });
    await writer.addMessage({
      channelId: 1,
      data: new Uint8Array(),
      logTime: 5000000000n, // 5 seconds
      publishTime: 5000000000n,
      sequence: 2,
    });
    await writer.end();

    const readable = new BlobReadable(new Blob([tempBuffer.get().slice()]));
    const decompressHandlers = await loadDecompressHandlers();
    const reader = await McapIndexedReader.Initialize({ readable, decompressHandlers });

    const source = new McapIndexedIterableSource(reader);

    const { topicStats, start, end } = await source.initialize();

    expect(topicStats).toBeDefined();
    const testTopicStats = topicStats.get("test");
    expect(testTopicStats).toBeDefined();
    // topicStats only contains numMessages (MCAP footer doesn't have per-topic time boundaries)
    expect(testTopicStats?.numMessages).toBe(2);
    expect(testTopicStats?.firstMessageTime).toBeUndefined();
    expect(testTopicStats?.lastMessageTime).toBeUndefined();
    // Global start/end times are exposed separately via Initialization
    expect(start).toEqual({ sec: 1, nsec: 0 });
    expect(end).toEqual({ sec: 5, nsec: 0 });
  });

  describe("getEnd", () => {
    it("should return undefined before initialization", async () => {
      // Given an indexed source that has not been initialized
      const tempBuffer = new TempBuffer();
      const writer = new McapWriter({ writable: tempBuffer, startChannelId: 1 });
      await writer.start({ library: "", profile: "" });
      await writer.registerSchema({
        data: new Uint8Array(),
        encoding: "test",
        name: "test",
      });
      await writer.registerChannel({
        messageEncoding: "1",
        schemaId: 1,
        metadata: new Map(),
        topic: "test",
      });
      await writer.addMessage({
        channelId: 1,
        data: new Uint8Array(),
        logTime: 0n,
        publishTime: 0n,
        sequence: 1,
      });
      await writer.end();

      const readable = new BlobReadable(new Blob([tempBuffer.get().slice()]));
      const decompressHandlers = await loadDecompressHandlers();
      const reader = await McapIndexedReader.Initialize({ readable, decompressHandlers });
      const source = new McapIndexedIterableSource(reader);

      // When calling getEnd before initialize
      // Then it should return undefined
      expect(source.getEnd()).toBeUndefined();
    });

    it("should return the latest message end time after initialization", async () => {
      // Given an indexed MCAP with messages spanning from 2s to 10s
      const tempBuffer = new TempBuffer();
      const writer = new McapWriter({ writable: tempBuffer, startChannelId: 1 });
      await writer.start({ library: "", profile: "" });
      await writer.registerSchema({
        data: new Uint8Array(),
        encoding: "test",
        name: "test",
      });
      await writer.registerChannel({
        messageEncoding: "1",
        schemaId: 1,
        metadata: new Map(),
        topic: "test",
      });
      await writer.addMessage({
        channelId: 1,
        data: new Uint8Array(),
        logTime: 2_000_000_000n,
        publishTime: 0n,
        sequence: 1,
      });
      await writer.addMessage({
        channelId: 1,
        data: new Uint8Array(),
        logTime: 10_000_000_000n,
        publishTime: 0n,
        sequence: 2,
      });
      await writer.end();

      const readable = new BlobReadable(new Blob([tempBuffer.get().slice()]));
      const decompressHandlers = await loadDecompressHandlers();
      const reader = await McapIndexedReader.Initialize({ readable, decompressHandlers });
      const source = new McapIndexedIterableSource(reader);

      // When initializing and calling getEnd
      await source.initialize();

      // Then getEnd should return the latest message time
      expect(source.getEnd()).toEqual({ sec: 10, nsec: 0 });
    });
  });
  it("preserves container and channel facts and sums all publishers on a topic", async () => {
    const buffer = new TempBuffer();
    const writer = new McapWriter({ writable: buffer, useChunks: true });
    await writer.start({ library: "inspector-test", profile: "" });
    const schemaId = await writer.registerSchema({
      name: "Example",
      encoding: "jsonschema",
      data: new TextEncoder().encode('{"type":"object"}'),
    });
    const firstId = await writer.registerChannel({
      topic: "/shared",
      schemaId,
      messageEncoding: "json",
      metadata: new Map([["callerid", "first"]]),
    });
    const secondId = await writer.registerChannel({
      topic: "/shared",
      schemaId,
      messageEncoding: "json",
      metadata: new Map([["callerid", "second"]]),
    });
    for (const channelId of [firstId, secondId, secondId]) {
      await writer.addMessage({
        channelId,
        logTime: 1_000_000_000n,
        publishTime: 1_000_000_000n,
        sequence: 0,
        data: new TextEncoder().encode("{}"),
      });
    }
    await writer.end();
    const readable = new BlobReadable(new Blob([buffer.get().slice()]));
    const reader = await McapIndexedReader.Initialize({
      readable,
      decompressHandlers: await loadDecompressHandlers(),
    });
    const result = await new McapIndexedIterableSource(reader).initialize();
    expect(result.topicStats.get("/shared")?.numMessages).toBe(3);
    expect(result.recordingFiles?.[0]?.library).toBe("inspector-test");
    expect(
      result.recordingFiles?.[0]?.channels.map((channel) => channel.metadata.callerid),
    ).toEqual(["first", "second"]);
    expect(result.recordingFiles?.[0]?.compression[0]).toMatchObject({ format: "none" });
  });

  it("skims only the tail of each window and the latest message of slower topics", async () => {
    const tempBuffer = new TempBuffer();
    const writer = new McapWriter({ writable: tempBuffer, startChannelId: 1, chunkSize: 500 });
    await writer.start({ library: "", profile: "" });
    for (const topic of ["fast", "slow"]) {
      await writer.registerChannel({
        messageEncoding: "json",
        schemaId: 0,
        metadata: new Map(),
        topic,
      });
    }
    for (let ms = 0n; ms < 2000n; ms += 10n) {
      const logTime = ms * 1_000_000n;
      await writer.addMessage({
        channelId: 1,
        data: new Uint8Array(100),
        logTime,
        publishTime: logTime,
        sequence: 0,
      });
      if (ms % 500n === 0n) {
        await writer.addMessage({
          channelId: 2,
          data: new Uint8Array(100),
          logTime,
          publishTime: logTime,
          sequence: 0,
        });
      }
    }
    await writer.end();

    const blobReadable = new BlobReadable(new Blob([tempBuffer.get().slice()]));
    let bytesRead = 0;
    const readable = {
      size: async () => await blobReadable.size(),
      read: async (offset: bigint, length: bigint) => {
        bytesRead += Number(length);
        return await blobReadable.read(offset, length);
      },
    };
    const reader = await McapIndexedReader.Initialize({
      readable,
      decompressHandlers: await loadDecompressHandlers(),
    });
    const source = new McapIndexedIterableSource(reader);
    await source.initialize();
    const topics = new Map([
      ["fast", { topic: "fast" }],
      ["slow", { topic: "slow" }],
    ]);

    const read = async (skimInterval?: { sec: number; nsec: number }) => {
      bytesRead = 0;
      const out: string[] = [];
      for await (const result of source.messageIterator({ topics, skimInterval })) {
        if (result.type === "message-event") {
          const { topic, receiveTime } = result.msgEvent;
          out.push(`${topic}@${receiveTime.sec * 1000 + receiveTime.nsec / 1e6}`);
        } else if (result.type === "stamp") {
          out.push(`stamp@${result.stamp.sec * 1000 + Math.round(result.stamp.nsec / 1e6)}`);
        }
      }
      return { out, bytesRead };
    };

    const full = await read();
    const skim = await read({ sec: 1, nsec: 0 });

    expect(full.out).toHaveLength(204);
    expect(skim.out).toEqual([
      "slow@500",
      "fast@950",
      "fast@960",
      "fast@970",
      "fast@980",
      "fast@990",
      "stamp@1000",
      "slow@1500",
      // the last window ends at the last message (1990), so its tail starts at 1940
      "fast@1940",
      "fast@1950",
      "fast@1960",
      "fast@1970",
      "fast@1980",
      "fast@1990",
      "stamp@1990",
    ]);
    expect(skim.bytesRead).toBeLessThan(full.bytesRead / 3);
  });
});
