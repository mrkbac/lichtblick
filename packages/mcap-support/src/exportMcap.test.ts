// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { McapIndexedReader, McapWriter } from "@mcap/core";

import { TempBuffer } from "./TempBuffer";
import { exportMcap } from "./exportMcap";

async function makeInput(): Promise<McapIndexedReader> {
  const buffer = new TempBuffer();
  const writer = new McapWriter({ writable: buffer });
  await writer.start({ profile: "ros2", library: "test" });
  const schemaId = await writer.registerSchema({
    name: "std_msgs/String",
    encoding: "ros2msg",
    data: new TextEncoder().encode("string data"),
  });
  const topics = ["/a", "/b", "/c"];
  const channelIds = await Promise.all(
    topics.map(
      async (topic) =>
        await writer.registerChannel({
          topic,
          schemaId,
          messageEncoding: "cdr",
          metadata: new Map(),
        }),
    ),
  );
  for (let t = 0; t < 10; t++) {
    for (const channelId of channelIds) {
      await writer.addMessage({
        channelId,
        sequence: t,
        logTime: BigInt(t),
        publishTime: BigInt(t),
        data: new Uint8Array([channelId, t]),
      });
    }
  }
  await writer.addAttachment({
    name: "calib.yaml",
    mediaType: "text/yaml",
    logTime: 0n,
    createTime: 0n,
    data: new Uint8Array([1]),
  });
  await writer.addMetadata({ name: "info", metadata: new Map([["k", "v"]]) });
  await writer.end();
  return await McapIndexedReader.Initialize({ readable: buffer });
}

async function readAll(reader: McapIndexedReader) {
  const messages = [];
  for await (const message of reader.readMessages()) {
    messages.push({
      topic: reader.channelsById.get(message.channelId)!.topic,
      logTime: message.logTime,
      data: [...message.data],
    });
  }
  return messages;
}

describe("exportMcap", () => {
  it("keeps, drops, renames, decimates and trims", async () => {
    const input = await makeInput();
    const output = new TempBuffer();
    const progress: number[] = [];

    const result = await exportMcap(input, output, {
      topics: new Map([
        ["/a", { outputTopic: "/renamed" }],
        ["/b", { everyNth: 2 }],
      ]),
      startTime: 2n,
      endTime: 6n,
      onProgress: (p) => progress.push(p),
    });

    const reader = await McapIndexedReader.Initialize({ readable: output });
    const messages = await readAll(reader);
    const topics = [...reader.channelsById.values()].map((c) => c.topic).sort();

    expect(topics).toEqual(["/b", "/renamed"]);
    expect(messages.filter((m) => m.topic === "/renamed").map((m) => m.logTime)).toEqual([
      2n,
      3n,
      4n,
      5n,
      6n,
    ]);
    expect(messages.filter((m) => m.topic === "/b").map((m) => m.logTime)).toEqual([2n, 4n, 6n]);
    // payloads are untouched
    expect(messages.find((m) => m.topic === "/renamed")!.data).toEqual([0, 2]);
    expect(result.messageCount).toBe(8);
    expect(reader.schemasById.size).toBe(1);
    expect(reader.statistics?.messageCount).toBe(8n);
    expect(reader.attachmentIndexes).toHaveLength(0);
    expect(reader.metadataIndexes).toHaveLength(0);
    expect(progress.at(-1)).toBe(1);
  });

  it("copies attachments and metadata when asked", async () => {
    const input = await makeInput();
    const output = new TempBuffer();

    await exportMcap(input, output, {
      topics: new Map([["/c", {}]]),
      includeAttachments: true,
      includeMetadata: true,
      compressChunk: (data) => ({ compression: "", compressedData: data }),
    });

    const reader = await McapIndexedReader.Initialize({ readable: output });
    expect(await readAll(reader)).toHaveLength(10);
    expect(reader.attachmentIndexes.map((a) => a.name)).toEqual(["calib.yaml"]);
    expect(reader.metadataIndexes.map((m) => m.name)).toEqual(["info"]);
  });

  it("stops when aborted", async () => {
    const input = await makeInput();
    const controller = new AbortController();
    controller.abort();
    await expect(
      exportMcap(input, new TempBuffer(), {
        topics: new Map([["/a", {}]]),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});
