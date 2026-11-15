// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapWriter } from "./McapWriter.ts";
import { TempBuffer } from "./TempBuffer.ts";
import { isEmptyMcap } from "./isEmptyMcap.ts";

describe("isEmptyMcap", () => {
  async function mcap(messages: number, finished = messages > 0): Promise<Blob> {
    const buffer = new TempBuffer();
    const writer = new McapWriter({ writable: buffer });
    await writer.start({ profile: "", library: "test" });
    if (messages > 0) {
      const schemaId = await writer.registerSchema({
        name: "S",
        encoding: "",
        data: new Uint8Array(),
      });
      const channelId = await writer.registerChannel({
        topic: "/a",
        schemaId,
        messageEncoding: "json",
        metadata: new Map(),
      });
      for (let i = 0; i < messages; i++) {
        await writer.addMessage({
          channelId,
          sequence: i,
          logTime: 0n,
          publishTime: 0n,
          data: new Uint8Array(),
        });
      }
    }
    if (finished) {
      await writer.end();
    }
    return new Blob([buffer.get().slice()]);
  }

  it("is true for a recording cut off before any message", async () => {
    await expect(isEmptyMcap(await mcap(0))).resolves.toBe(true);
  });

  it("keeps files whose records don't add up, or that aren't MCAP", async () => {
    const header = new Uint8Array(await (await mcap(0)).arrayBuffer());
    const cutOff = header.slice(0, header.length - 1);
    await expect(isEmptyMcap(new Blob([cutOff]))).resolves.toBe(false);
    await expect(isEmptyMcap(new Blob([new Uint8Array(20)]))).resolves.toBe(false);
  });

  it("is true for a finished recording without messages", async () => {
    await expect(isEmptyMcap(await mcap(0, true))).resolves.toBe(true);
  });

  it("keeps files without a header first, or with only the magic", async () => {
    const header = new Uint8Array(await (await mcap(0)).arrayBuffer());
    const noHeader = header.slice();
    noHeader[8] = 0x04; // a channel record where the header belongs
    await expect(isEmptyMcap(new Blob([noHeader]))).resolves.toBe(false);
    await expect(isEmptyMcap(new Blob([header.slice(0, 8)]))).resolves.toBe(false);
  });

  it("is false once a message was written", async () => {
    await expect(isEmptyMcap(await mcap(1))).resolves.toBe(false);
  });
});
