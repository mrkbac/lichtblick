// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { crc32 } from "@foxglove/crc";
import type { McapTypes } from "@mcap/core";
import { Semaphore } from "async-mutex";

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
 * An empty file next to an entry, rewritten each time the entry is used: its modification time is
 * when the entry was last used, without rewriting the entry. Eviction drops the least recently
 * used entries first.
 */
const USED_SUFFIX = ".used";

/** How far each scan step reads before `onStep` sees the index */
export const SCAN_STEP_BYTES = 16n * 1024n * 1024n;
/** Steps before the first chunk is indexed are this short, so a file opens after its first chunk */
export const FIRST_STEP_BYTES = 1024n * 1024n;
/**
 * Scan steps running at once in this worker. Each holds a read window and a decompressed chunk, so
 * scanning many files keeps memory flat. Steps of files not open yet go first, then they take turns.
 */
const scanSteps = new Semaphore(2);

/**
 * A recovery scan that reuses the index saved in OPFS by an earlier scan of the same file, so
 * reopening a footer-less file skips the forward scan. A file that grew since then is scanned
 * from where the saved index ends. Without OPFS (Node, private windows, quota) this just scans.
 *
 * `onStep` is called after each step (`SCAN_STEP_BYTES`, shorter until the first chunk) with the
 * scanner and its index so far, once that has at least one chunk, so the file can be shown while
 * the rest is scanned.
 */
export async function scanWithIndexCache(
  readable: McapTypes.IReadable,
  decompressHandlers: McapTypes.DecompressHandlers,
  onStep?: (scanner: McapRecoveryScanner) => void,
): Promise<McapRecoveryScanner> {
  const size = await readable.size();
  const key = await cacheKey(readable, size).catch(() => undefined);
  const cached = key != undefined ? await load(key, readable, decompressHandlers) : undefined;
  const scanner = cached?.scanner ?? new McapRecoveryScanner(decompressHandlers);
  if (cached?.size === size) {
    // The same file again: whatever followed the index the last time is still unreadable
    scanner.unreadableBytes = scanner.complete ? 0n : size - scanner.offset;
  } else if (!scanner.complete) {
    // Each step awaits reads, which lets message requests to this worker run in between
    const step = async () =>
      await scanner.scan(
        readable,
        scanner.recoveredChunkCount() > 0 ? SCAN_STEP_BYTES : FIRST_STEP_BYTES,
      );
    while (await scanSteps.runExclusive(step, 1, scanner.recoveredChunkCount() > 0 ? 0 : 1)) {
      if (scanner.recoveredChunkCount() > 0) {
        onStep?.(scanner);
      }
    }
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
    const dir = await directory();
    const file = await (await dir.getFileHandle(key)).getFile();
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
    await write(dir, key + USED_SUFFIX, new Uint8Array(0)).catch(() => {});
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
  const dir = await directory(); // first, so a missing OPFS fails before copying the index
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

  await evict(dir, key, MAX_CACHE_BYTES - entry.byteLength);
  await write(dir, key, entry);
}

async function write(
  dir: FileSystemDirectoryHandle,
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  if ("createWritable" in handle) {
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
  } else {
    // Safari before 26 only has sync access handles, and only in workers (where this runs)
    const access = await (
      handle as { createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> }
    ).createSyncAccessHandle();
    access.truncate(0);
    access.write(bytes, { at: 0 });
    access.close();
  }
}

/** Deletes the least recently used entries (other than `key`) until the rest fit `budget` */
async function evict(dir: FileSystemDirectoryHandle, key: string, budget: number): Promise<void> {
  const entries = new Map<string, { size: number; lastUsed: number }>();
  const used = new Map<string, number>();
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== "file") {
      continue;
    }
    const file = await handle.getFile();
    if (name.endsWith(USED_SUFFIX)) {
      used.set(name.slice(0, -USED_SUFFIX.length), file.lastModified);
    } else if (name !== key) {
      entries.set(name, { size: file.size, lastUsed: file.lastModified });
    }
  }
  const byLastUse = [...entries].map(([name, entry]) => ({
    name,
    size: entry.size,
    lastUsed: Math.max(entry.lastUsed, used.get(name) ?? 0),
  }));
  byLastUse.sort((a, b) => b.lastUsed - a.lastUsed);
  let total = 0;
  for (const entry of byLastUse) {
    total += entry.size;
    if (total > budget) {
      await dir.removeEntry(entry.name).catch(() => {});
      await dir.removeEntry(entry.name + USED_SUFFIX).catch(() => {});
    }
  }
}
