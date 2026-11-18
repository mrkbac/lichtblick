// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapWriter, TempBuffer } from "@lichtblick/mcap-core";

import { attachmentData, hexDump, previewKind, readAttachmentIndexes } from "./attachments";

describe("attachments", () => {
  it("slices exactly each attachment's data out of the file", async () => {
    const buffer = new TempBuffer();
    const writer = new McapWriter({ writable: buffer });
    await writer.start({ profile: "", library: "test" });
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
    await writer.end();
    const file = new Blob([buffer.get().slice()]);

    const indexes = await readAttachmentIndexes(file);
    const texts = await Promise.all(
      indexes.map(async (index) => await attachmentData(file, index).text()),
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

  it("hex dumps with an ASCII column", () => {
    expect(hexDump(new TextEncoder().encode("AB\n"))).toBe(
      `00000000  41 42 0a${" ".repeat(39)}  AB.`,
    );
  });
});
