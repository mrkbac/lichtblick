// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  BlobReadable,
  ChunkCache,
  type McapTypes,
  openCachedMcapReader,
} from "@lichtblick/mcap-core";

import { PreviewKind } from "./types";

/** Reads only the file's summary; attachment data stays on disk until sliced. */
export async function readAttachmentIndexes(
  file: Blob,
): Promise<readonly McapTypes.AttachmentIndex[]> {
  // No chunks are read, so the cache stays empty.
  const reader = await openCachedMcapReader({
    readable: new BlobReadable(file),
    chunkCache: new ChunkCache(),
  });
  return reader.attachmentIndexes;
}

/**
 * The attachment's data as a lazy slice of the file, so large attachments are never copied into
 * memory. Attachment record: opcode u8, length u64, log_time u64, create_time u64, name string,
 * media_type string, data_len u64, data, crc u32 (strings are a u32 byte length + UTF-8).
 */
export function attachmentData(file: Blob, index: McapTypes.AttachmentIndex): Blob {
  const encoder = new TextEncoder();
  const start =
    Number(index.offset) +
    1 +
    8 +
    8 +
    8 +
    4 +
    encoder.encode(index.name).length +
    4 +
    encoder.encode(index.mediaType).length +
    8;
  return file.slice(start, start + Number(index.dataSize), index.mediaType);
}

const TEXT_TYPE = /^text\/|[/+](json|xml|yaml|x-yaml|toml|javascript|csv|x-sh|x-python)$/i;

/** Which preview fits; `head` (the first bytes) decides for unknown media types. */
export function previewKind(mediaType: string, head: Uint8Array): PreviewKind {
  const type = mediaType.toLowerCase().split(";")[0]!.trim();
  if (type.startsWith("image/")) {
    return "image";
  }
  if (type.startsWith("video/")) {
    return "video";
  }
  if (type.startsWith("audio/")) {
    return "audio";
  }
  if (type === "application/pdf") {
    return "pdf";
  }
  if (TEXT_TYPE.test(type)) {
    return "text";
  }
  // Unknown or generic (application/octet-stream, empty): text if it has no NUL and is valid UTF-8.
  // The head may end mid-character, so a trailing partial sequence is allowed.
  if (head.includes(0)) {
    return "binary";
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return "text";
  } catch {
    return "binary";
  }
}

/**
 * JSON is re-indented; anything else is shown as is. Numbers keep their source text, so integers
 * beyond 2^53 and long decimals aren't rounded. Without `JSON.rawJSON` the text is shown as is.
 */
export function formatText(text: string, mediaType: string): string {
  // ES2025 (Chrome 114+, Firefox 135+, Safari 18.4+); not in TypeScript's lib yet.
  const rawJSON = (JSON as JSON & { rawJSON?: (source: string) => unknown }).rawJSON;
  if (!/json/i.test(mediaType) || rawJSON == undefined) {
    return text;
  }
  try {
    const parsed: unknown = JSON.parse(
      text,
      (_key, value: unknown, context?: { source?: string }) =>
        typeof value === "number" && context?.source != undefined ? rawJSON(context.source) : value,
    );
    return JSON.stringify(parsed, undefined, 2) ?? text;
  } catch {
    // Not valid JSON after all: show the raw text.
    return text;
  }
}

/** Classic 16-bytes-per-row hex dump with an ASCII column. */
export function hexDump(bytes: Uint8Array): string {
  const rows: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = bytes.subarray(offset, offset + 16);
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."));
    rows.push(`${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii.join("")}`);
  }
  return rows.join("\n");
}
