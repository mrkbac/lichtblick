// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapWriter, TempBuffer } from "@mcap/core";

import { summarizeMcap } from "./summarizeMcap";

const SEC = 1_000_000_000n;
const NOW_MS = Date.UTC(2026, 10, 1);

async function writeMcap(
  logTimes: bigint[],
  opts: { chunkSize?: number; summary?: boolean } = {},
): Promise<Blob> {
  const buffer = new TempBuffer();
  const writer = new McapWriter({
    writable: buffer,
    chunkSize: opts.chunkSize,
    repeatSchemas: opts.summary ?? true,
    repeatChannels: opts.summary ?? true,
    useStatistics: opts.summary ?? true,
    useChunkIndex: opts.summary ?? true,
    useSummaryOffsets: opts.summary ?? true,
    useMessageIndex: opts.summary ?? true,
  });
  await writer.start({ library: "", profile: "" });
  const schemaId = await writer.registerSchema({
    name: "pkg/Msg",
    encoding: "jsonschema",
    data: new Uint8Array(),
  });
  const a = await writer.registerChannel({
    topic: "/a",
    schemaId,
    messageEncoding: "json",
    metadata: new Map(),
  });
  const b = await writer.registerChannel({
    topic: "/b",
    schemaId,
    messageEncoding: "json",
    metadata: new Map(),
  });
  for (const [i, logTime] of logTimes.entries()) {
    await writer.addMessage({
      channelId: i % 2 === 0 ? a : b,
      sequence: i,
      logTime,
      publishTime: logTime,
      data: new Uint8Array([1]),
    });
  }
  await writer.end();
  return new Blob([new Uint8Array(buffer.get())]);
}

describe("summarizeMcap", () => {
  const t0 = 1_780_000_000n * SEC; // 2026-05-28

  it("reads topics, counts and time bounds from the summary", async () => {
    const summary = await summarizeMcap(await writeMcap([t0, t0 + SEC, t0 + 2n * SEC]), NOW_MS);
    expect(summary).toEqual({
      start: { sec: 1_780_000_000, nsec: 0 },
      end: { sec: 1_780_000_002, nsec: 0 },
      messages: 3,
      topics: [
        { name: "/a", schema: "pkg/Msg", messages: 2 },
        { name: "/b", schema: "pkg/Msg", messages: 1 },
      ],
    });
  });

  it("ignores chunks with outlier stamps", async () => {
    // One message per chunk, so the 1970 stamp lands in its own chunk.
    const file = await writeMcap([5n * SEC, t0, t0 + 10n * SEC], { chunkSize: 1 });
    const summary = await summarizeMcap(file, NOW_MS);
    expect(summary.start).toEqual({ sec: 1_780_000_000, nsec: 0 });
    expect(summary.end).toEqual({ sec: 1_780_000_010, nsec: 0 });
  });

  it("keeps simulation time when no stamp looks like wall-clock time", async () => {
    const summary = await summarizeMcap(await writeMcap([5n * SEC, 7n * SEC]), NOW_MS);
    expect(summary.start).toEqual({ sec: 5, nsec: 0 });
    expect(summary.end).toEqual({ sec: 7, nsec: 0 });
  });

  it("reports files without a summary", async () => {
    const file = await writeMcap([t0], { summary: false });
    await expect(summarizeMcap(file, NOW_MS)).resolves.toEqual({ noSummary: true });
  });
});
