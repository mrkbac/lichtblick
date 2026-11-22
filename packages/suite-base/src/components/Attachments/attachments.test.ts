// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  BlobReadable,
  ChunkCache,
  McapWriter,
  TempBuffer,
  openCachedMcapReader,
} from "@lichtblick/mcap-core";

import { AttachmentInfo, attachmentData, formatText, hexDump, previewKind } from "./attachments";

describe("attachments", () => {
  const attachments = [
    { name: "ünïcode.json", mediaType: "application/json", data: '{"a":1}' },
    { name: "b.bin", mediaType: "", data: "\u0000\u0001xyz" },
  ];

  /** A recording with `attachments` and the infos a player lists for it */
  async function recording(): Promise<{ bytes: Uint8Array; infos: AttachmentInfo[] }> {
    const buffer = new TempBuffer();
    const writer = new McapWriter({ writable: buffer });
    await writer.start({ profile: "", library: "test" });
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
    const bytes = buffer.get().slice();
    const reader = await openCachedMcapReader({
      readable: new BlobReadable(new Blob([bytes])),
      chunkCache: new ChunkCache(),
    });
    const infos = reader.attachmentIndexes.map((index) => ({
      name: index.name,
      mediaType: index.mediaType,
      sizeBytes: Number(index.dataSize),
      offset: Number(index.offset),
    }));
    return { bytes, infos };
  }

  it("slices exactly each attachment's data out of the file", async () => {
    const { bytes, infos } = await recording();
    const file = new Blob([bytes]);
    const texts = await Promise.all(
      infos.map(async (info) => await (await attachmentData(file, info))?.text()),
    );
    expect(texts).toEqual(attachments.map((attachment) => attachment.data));
  });

  it("reads attachments of a file without a summary, as listed for a recovered recording", async () => {
    const { bytes, infos } = await recording();
    // Cut off like an interrupted recording: no footer or summary left.
    const file = new Blob([bytes.slice(0, Number(infos.at(-1)!.offset) + 64)]);
    expect(await (await attachmentData(file, infos[0]!))?.text()).toBe(attachments[0]!.data);
  });

  it("finds nothing where the file no longer has the attachment", async () => {
    const { bytes, infos } = await recording();
    const file = new Blob([bytes]);
    expect(
      await attachmentData(file, { ...infos[0]!, offset: infos[0]!.offset + 1 }),
    ).toBeUndefined();
    expect(await attachmentData(file, { ...infos[0]!, name: "other.json" })).toBeUndefined();
    expect(await attachmentData(file, { ...infos[0]!, sizeBytes: infos[0]!.sizeBytes + 1 })).toBeUndefined();
    expect(await attachmentData(new Blob([bytes.slice(0, 20)]), infos[1]!)).toBeUndefined();
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
