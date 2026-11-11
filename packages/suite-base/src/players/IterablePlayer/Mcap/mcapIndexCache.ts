// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { crc32 } from "@foxglove/crc";
import type { McapTypes } from "@mcap/core";

import Log from "@lichtblick/log";

import { McapRecoveryScanner } from "./McapRecoveryScanner";

const log = Log.getLogger(__filename);

const CACHE_DIR = "mcap-index-cache";
/** Total size of all cached indexes; the oldest entries are deleted past this */
export const MAX_CACHE_BYTES = 256 * 1024 * 1024;
/** The key is a hash of this many leading bytes, so a renamed or moved file still hits */
const KEY_BYTES = 64n * 1024n;
/** Bytes before the scanned offset that must still match, to catch a different file */
const CHECK_BYTES = 64n * 1024n;

/**
 * A recovery scan that reuses the index saved in OPFS by an earlier scan of the same file, so
 * reopening a footer-less file skips the forward scan. A file that grew since then is scanned
 * from where the saved index ends. Without OPFS (Node, private windows, quota) this just scans.
 */
export async function scanWithIndexCache(
  readable: McapTypes.IReadable,
  decompressHandlers: McapTypes.DecompressHandlers,
): Promise<McapRecoveryScanner> {
  const size = await readable.size();
  const key = await cacheKey(readable, size).catch(() => undefined);
  const cached = key != undefined ? await load(key, readable, decompressHandlers) : undefined;
  const scanner = cached?.scanner ?? new McapRecoveryScanner(decompressHandlers);
  if (cached?.size === size) {
    // The same file again: whatever followed the index the last time is still unreadable
    scanner.unreadableBytes = scanner.complete ? 0n : size - scanner.offset;
  } else if (!scanner.complete) {
    await scanner.scan(readable);
  }
  if (key != undefined && cached?.size !== size) {
    await save(key, scanner, readable).catch((error: unknown) => {
      log.debug("Not caching MCAP index", error);
    });
  }
  return scanner;
}

async function cacheKey(readable: McapTypes.IReadable, size: bigint): Promise<string> {
  const head = await readable.read(0n, size < KEY_BYTES ? size : KEY_BYTES);
  const digest = await crypto.subtle.digest("SHA-256", head.slice());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The bytes the entry's index was built from, ending at its offset */
async function checkBytes(readable: McapTypes.IReadable, offset: bigint): Promise<Uint8Array> {
  const start = offset > CHECK_BYTES ? offset - CHECK_BYTES : 0n;
  return await readable.read(start, offset - start);
}

async function directory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle(CACHE_DIR, { create: true });
}

/**
 * Entry layout: crc32 of the rest, file size (u64), check bytes length (u32), check bytes, snapshot.
 */
async function load(
  key: string,
  readable: McapTypes.IReadable,
  decompressHandlers: McapTypes.DecompressHandlers,
): Promise<{ scanner: McapRecoveryScanner; size: bigint } | undefined> {
  try {
    const file = await (await (await directory()).getFileHandle(key)).getFile();
    const entry = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(entry.buffer);
    if (crc32(entry.subarray(4)) !== view.getUint32(0, true)) {
      return undefined;
    }
    const size = view.getBigUint64(4, true);
    const checkLength = view.getUint32(12, true);
    const check = entry.subarray(16, 16 + checkLength);
    const scanner = McapRecoveryScanner.fromSnapshot(
      entry.subarray(16 + checkLength),
      decompressHandlers,
    );
    if (scanner.offset > (await readable.size())) {
      return undefined;
    }
    const actual = await checkBytes(readable, scanner.offset);
    if (actual.byteLength !== checkLength || !actual.every((byte, i) => byte === check[i])) {
      return undefined;
    }
    return { scanner, size };
  } catch {
    return undefined; // no entry, no OPFS, or an unreadable entry: scan instead
  }
}

async function save(
  key: string,
  scanner: McapRecoveryScanner,
  readable: McapTypes.IReadable,
): Promise<void> {
  const check = await checkBytes(readable, scanner.offset);
  const snapshot = scanner.toSnapshot();
  const entry = new Uint8Array(16 + check.byteLength + snapshot.byteLength);
  const view = new DataView(entry.buffer);
  view.setBigUint64(4, await readable.size(), true);
  view.setUint32(12, check.byteLength, true);
  entry.set(check, 16);
  entry.set(snapshot, 16 + check.byteLength);
  view.setUint32(0, crc32(entry.subarray(4)), true);
  if (entry.byteLength > MAX_CACHE_BYTES) {
    return;
  }

  const dir = await directory();
  await evict(dir, key, MAX_CACHE_BYTES - entry.byteLength);
  const handle = await dir.getFileHandle(key, { create: true });
  if ("createWritable" in handle) {
    const writable = await handle.createWritable();
    await writable.write(entry);
    await writable.close();
  } else {
    // Safari before 26 only has sync access handles, and only in workers (where this runs)
    const access = await (
      handle as { createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> }
    ).createSyncAccessHandle();
    access.truncate(0);
    access.write(entry, { at: 0 });
    access.close();
  }
}

/** Deletes the least recently written entries (other than `key`) until the rest fit `budget` */
async function evict(dir: FileSystemDirectoryHandle, key: string, budget: number): Promise<void> {
  // ponytail: "least recently written", not read; a hit doesn't refresh its entry. Track reads in
  // a small manifest if often-opened files get evicted by one-off ones.
  const entries: { name: string; size: number; lastModified: number }[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (name !== key && handle.kind === "file") {
      const file = await handle.getFile();
      entries.push({ name, size: file.size, lastModified: file.lastModified });
    }
  }
  entries.sort((a, b) => b.lastModified - a.lastModified);
  let total = 0;
  for (const entry of entries) {
    total += entry.size;
    if (total > budget) {
      await dir.removeEntry(entry.name).catch(() => {});
    }
  }
}
