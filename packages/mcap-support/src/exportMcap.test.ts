// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { McapIndexedReader, McapWriter } from "@mcap/core";

import { TempBuffer } from "./TempBuffer";
import { loadDecompressHandlers } from "./decompressHandlers";
import { ExportMcapOptions, countTimesInRange, exportMcap, readMessageTimes } from "./exportMcap";

type Input = { reader: McapIndexedReader; buffer: TempBuffer };

/** Three topics, 10 messages each at t=0..9, in chunks of about `chunkSize` bytes. */
async function makeInput({
  chunkSize,
  useMessageIndex = true,
}: {
  chunkSize?: number;
  useMessageIndex?: boolean;
} = {}): Promise<Input> {
  const buffer = new TempBuffer();
  const writer = new McapWriter({ writable: buffer, chunkSize, useMessageIndex });
  await writer.start({ profile: "ros2", library: "test" });
  const schemaId = await writer.registerSchema({
    name: "std_msgs/String",
    encoding: "ros2msg",
    data: new TextEncoder().encode("string data"),
  });
  const channelIds = [];
  for (const topic of ["/a", "/b", "/c"]) {
    channelIds.push(
      await writer.registerChannel({
        topic,
        schemaId,
        messageEncoding: "cdr",
        metadata: new Map(),
      }),
    );
  }
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
    logTime: 100n, // after the last message
    createTime: 0n,
    data: new Uint8Array([1]),
  });
  await writer.addMetadata({ name: "info", metadata: new Map([["k", "v"]]) });
  await writer.end();
  return { reader: await McapIndexedReader.Initialize({ readable: buffer }), buffer };
}

async function runExport(input: Input, options: ExportMcapOptions) {
  const output = new TempBuffer();
  const result = await exportMcap(input.reader, input.buffer, output, options);
  const reader = await McapIndexedReader.Initialize({
    readable: output,
    decompressHandlers: await loadDecompressHandlers(),
  });
  const messages = [];
  for await (const message of reader.readMessages()) {
    messages.push({
      topic: reader.channelsById.get(message.channelId)!.topic,
      logTime: Number(message.logTime),
      data: [...message.data],
    });
  }
  const times = (topic: string) => messages.filter((m) => m.topic === topic).map((m) => m.logTime);
  return { result, reader, messages, times };
}

describe("exportMcap", () => {
  it.each([
    ["one chunk", {}],
    ["many chunks", { chunkSize: 100 }],
    ["many chunks without message indexes", { chunkSize: 100, useMessageIndex: false }],
  ])("keeps, drops, renames, decimates and trims (%s)", async (_name, inputOptions) => {
    const input = await makeInput(inputOptions);
    const progress: number[] = [];

    const { result, reader, messages, times } = await runExport(input, {
      topics: new Map([
        ["/a", { outputTopic: "/renamed" }],
        ["/b", { everyNth: 2 }],
      ]),
      startTime: 2n,
      endTime: 6n,
      onProgress: (p) => progress.push(p),
    });

    expect([...reader.channelsById.values()].map((c) => c.topic).sort()).toEqual([
      "/b",
      "/renamed",
    ]);
    expect(times("/renamed")).toEqual([2, 3, 4, 5, 6]);
    // Decimation counts across chunk boundaries.
    expect(times("/b")).toEqual([2, 4, 6]);
    // Payloads are untouched.
    expect(messages.find((m) => m.topic === "/renamed")!.data).toEqual([0, 2]);
    expect(result.messageCount).toBe(8);
    expect(reader.schemasById.size).toBe(1);
    expect(reader.statistics?.messageCount).toBe(8n);
    expect(reader.statistics?.messageStartTime).toBe(2n);
    expect(reader.statistics?.messageEndTime).toBe(6n);
    expect(reader.attachmentIndexes).toHaveLength(0);
    expect(reader.metadataIndexes).toHaveLength(0);
    expect(progress.at(-1)).toBe(1);
  });

  it("copies chunks as-is when nothing in them changes", async () => {
    const input = await makeInput({ chunkSize: 100 });
    const { reader, times } = await runExport(input, {
      topics: new Map([
        ["/a", {}],
        ["/b", {}],
        ["/c", {}],
      ]),
      compression: "none",
    });

    expect(times("/a")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(reader.statistics?.messageCount).toBe(30n);
    expect(reader.chunkIndexes.map((c) => c.uncompressedSize)).toEqual(
      input.reader.chunkIndexes.map((c) => c.uncompressedSize),
    );
  });

  it("keeps attachments outside the message range on a full-range export", async () => {
    const input = await makeInput();
    const { reader, times } = await runExport(input, {
      topics: new Map([["/c", {}]]),
      includeAttachments: true,
      includeMetadata: true,
    });

    expect(times("/c")).toHaveLength(10);
    expect(reader.chunkIndexes[0]!.compression).toBe("zstd");
    expect(reader.attachmentIndexes.map((a) => a.name)).toEqual(["calib.yaml"]);
    expect(reader.metadataIndexes.map((m) => m.name)).toEqual(["info"]);
  });

  it("stops when aborted", async () => {
    const input = await makeInput();
    const controller = new AbortController();
    controller.abort();
    await expect(
      exportMcap(input.reader, input.buffer, new TempBuffer(), {
        topics: new Map([["/a", {}]]),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});

describe("readMessageTimes", () => {
  it("counts messages per channel in a range from the message indexes", async () => {
    const { reader, buffer } = await makeInput({ chunkSize: 100 });
    const times = (await readMessageTimes(reader, buffer))!;
    expect(times.size).toBe(3);
    expect(countTimesInRange(times.get(0)!, 2n, 6n)).toBe(5);
    expect(countTimesInRange(times.get(0)!, 10n, 20n)).toBe(0);
    expect(countTimesInRange(times.get(0)!, 0n, 9n)).toBe(10);
  });

  it("returns undefined without message indexes", async () => {
    const { reader, buffer } = await makeInput({ chunkSize: 100, useMessageIndex: false });
    expect(await readMessageTimes(reader, buffer)).toBeUndefined();
  });
});
