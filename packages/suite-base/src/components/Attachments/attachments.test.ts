// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapWriter, TempBuffer } from "@lichtblick/mcap-core";
import { McapIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/McapIterableSource";

import { attachmentData, formatText, hexDump, previewKind } from "./attachments";

describe("attachments", () => {
  it.each([
    ["finished", true],
    // Opened through the recovery scan: no summary, so nothing can re-read an attachment index.
    ["cut-off", false],
  ])("slices exactly each attachment's data out of a %s file", async (_, finished) => {
    const buffer = new TempBuffer();
    // Each message gets its own chunk, so the cut-off file still has a complete one to recover.
    const writer = new McapWriter({ writable: buffer, chunkSize: 1 });
    await writer.start({ profile: "", library: "test" });
    const channelId = await writer.registerChannel({
      schemaId: 0,
      topic: "/example",
      messageEncoding: "json",
      metadata: new Map(),
    });
    const attachments = [
      { name: "ünïcode.json", mediaType: "application/json", data: '{"a":1}' },
      { name: "b.bin", mediaType: "", data: "\u0000\u0001xyz" },
    ];
    for (const [i, attachment] of attachments.entries()) {
      await writer.addAttachment({
        logTime: BigInt(i),
        createTime: 0n,
        name: attachment.name,
        mediaType: attachment.mediaType,
        data: new TextEncoder().encode(attachment.data),
      });
    }
    await writer.addMessage({
      channelId,
      sequence: 0,
      logTime: 1n,
      publishTime: 1n,
      data: new TextEncoder().encode("{}"),
    });
    if (finished) {
      await writer.end();
    }
    const file = new Blob([buffer.get().slice()]);

    const { recordingFiles } = await new McapIterableSource({ type: "file", file }).initialize();
    const listed = recordingFiles?.[0]?.attachments ?? [];
    const texts = await Promise.all(
      listed.map(async (attachment) => await attachmentData(file, attachment).text()),
    );
    expect(texts).toEqual(attachments.map((attachment) => attachment.data));
  });

  it("picks a preview from the media type, else from the bytes", () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(previewKind("image/png", bytes(""))).toBe("image");
    expect(previewKind("application/x-yaml", bytes(""))).toBe("text");
    expect(previewKind("application/pdf", bytes(""))).toBe("pdf");
    expect(previewKind("application/octet-stream", bytes("<robot/>"))).toBe("text");
    expect(previewKind("", new Uint8Array([0x89, 0x50, 0, 1]))).toBe("binary");
    expect(previewKind("", new Uint8Array([0xff, 0xfe]))).toBe("binary");
  });

  it("re-indents JSON without rounding its numbers", () => {
    expect(formatText('{"id":9007199254740993,"x":[1.10]}', "application/json")).toBe(
      '{\n  "id": 9007199254740993,\n  "x": [\n    1.10\n  ]\n}',
    );
    expect(formatText("{not json", "application/json")).toBe("{not json");
  });

  it("hex dumps with an ASCII column", () => {
    expect(hexDump(new TextEncoder().encode("AB\n"))).toBe(
      `00000000  41 42 0a${" ".repeat(39)}  AB.`,
    );
  });
});
