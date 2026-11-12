// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapIndexedReader, McapTypes, McapWriter, TempBuffer } from "@mcap/core";

import { loadDecompressHandlers } from "@lichtblick/mcap-support";

import { BlobReadable } from "./BlobReadable";
import { McapIterableSource } from "./McapIterableSource";
import { McapRecoveryScanner } from "./McapRecoveryScanner";
import { MAX_CACHE_BYTES, scanWithIndexCache } from "./mcapIndexCache";

/** Footer-less recording with one message per chunk; `count` messages at 1s, 2s, … */
async function footerless(count: number, messageBytes = 1): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = new TempBuffer();
  const writer = new McapWriter({ writable: buffer, chunkSize: 1 });
  await writer.start({ library: "test", profile: "" });
  const channelId = await writer.registerChannel({
    schemaId: 0,
    topic: "/example",
    messageEncoding: "json",
    metadata: new Map(),
  });
  for (let i = 1; i <= count; i++) {
    await writer.addMessage({
      channelId,
      sequence: i,
      logTime: BigInt(i) * 1_000_000_000n,
      publishTime: BigInt(i) * 1_000_000_000n,
      data: new TextEncoder().encode(String(i).padEnd(messageBytes)),
    });
  }
  return buffer.get().slice();
}

function readableOf(bytes: Uint8Array<ArrayBuffer>): McapTypes.IReadable {
  return new BlobReadable(new Blob([bytes]));
}

async function readValues(readable: McapTypes.IReadable): Promise<number[]> {
  const reader = await McapIndexedReader.Initialize({ readable });
  const values: number[] = [];
  for await (const message of reader.readMessages()) {
    values.push(Number(new TextDecoder().decode(message.data)));
  }
  return values;
}

/** An in-memory OPFS root with the subset of the API the cache uses */
function fakeOpfs() {
  const files = new Map<string, { bytes: Uint8Array<ArrayBuffer>; lastModified: number }>();
  let clock = 0;
  const directory = {
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!files.has(name) && options?.create !== true) {
        throw new DOMException("not found", "NotFoundError");
      }
      return {
        kind: "file",
        getFile: async () => {
          const file = files.get(name)!;
          return new File([file.bytes], name, { lastModified: file.lastModified });
        },
        createWritable: async () => {
          let bytes = new Uint8Array(0);
          return {
            write: async (data: Uint8Array) => {
              bytes = data.slice();
            },
            close: async () => {
              files.set(name, { bytes, lastModified: ++clock });
            },
          };
        },
      };
    },
    async *entries() {
      for (const name of [...files.keys()]) {
        yield [name, await directory.getFileHandle(name)] as const;
      }
    },
    removeEntry: async (name: string) => {
      files.delete(name);
    },
  };
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: { getDirectory: async () => ({ getDirectoryHandle: async () => directory }) },
  });
  return files;
}

describe("scanWithIndexCache", () => {
  let files: ReturnType<typeof fakeOpfs>;
  let scan: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    files = fakeOpfs();
    scan = vi.spyOn(McapRecoveryScanner.prototype, "scan");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not scan a footer-less file the second time it is opened", async () => {
    const bytes = await footerless(5);
    const first = await scanWithIndexCache(readableOf(bytes), await loadDecompressHandlers());
    expect(scan).toHaveBeenCalledTimes(1);
    expect(files.size).toBe(1);

    const second = await scanWithIndexCache(readableOf(bytes), await loadDecompressHandlers());
    expect(scan).toHaveBeenCalledTimes(1);
    expect(second.offset).toBe(first.offset);
    expect(second.messageCount).toBe(5n);
    expect(second.toAlert()).toEqual(first.toAlert());
    expect(await readValues(second.toReadable(readableOf(bytes)))).toEqual([1, 2, 3, 4, 5]);
  });

  it("opens through McapIterableSource from the cache", async () => {
    const bytes = await footerless(3);
    await new McapIterableSource({ type: "file", file: new Blob([bytes]) }).initialize();
    const init = await new McapIterableSource({
      type: "file",
      file: new Blob([bytes]),
    }).initialize();

    expect(scan).toHaveBeenCalledTimes(1);
    expect(init.end).toEqual({ sec: 3, nsec: 0 });
  });

  it("resumes from the cached offset when the file grew", async () => {
    // Larger than the key window, so the key is the same for both
    const full = await footerless(6, 30_000);
    const handlers = await loadDecompressHandlers();
    const cut = full.slice(0, full.byteLength - 1000);
    const partial = await scanWithIndexCache(readableOf(cut), handlers);
    const fromSnapshot = vi.spyOn(McapRecoveryScanner, "fromSnapshot");

    const grown = await scanWithIndexCache(readableOf(full), handlers);

    expect(partial.messageCount).toBe(5n);
    expect(fromSnapshot.mock.results[0]?.value).toBe(grown);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(grown.messageCount).toBe(6n);
    expect(await readValues(grown.toReadable(readableOf(full)))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("ignores an entry whose bytes no longer match the file", async () => {
    // Larger than the key window, so the key stays the same and only the check bytes differ
    const bytes = await footerless(5, 30_000);
    const handlers = await loadDecompressHandlers();
    await scanWithIndexCache(readableOf(bytes), handlers);
    const changed = bytes.slice();
    changed[changed.byteLength - 5000]! ^= 0xff; // inside the last message, before the offset

    const scanner = await scanWithIndexCache(readableOf(changed), handlers);

    expect(scan).toHaveBeenCalledTimes(2);
    expect(scanner.corruptRecords).toBe(1);
    expect(files.size).toBe(1);
  });

  it("evicts the oldest entries past the size cap", async () => {
    const handlers = await loadDecompressHandlers();
    await scanWithIndexCache(readableOf(await footerless(2)), handlers);
    const [oldest] = files.keys();
    files.get(oldest!)!.bytes = new Uint8Array(MAX_CACHE_BYTES - 10);

    await scanWithIndexCache(readableOf(await footerless(3)), handlers);

    expect(files.has(oldest!)).toBe(false);
    expect(files.size).toBe(1);
  });

  it("scans without OPFS", async () => {
    Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });
    const bytes = await footerless(2);
    const handlers = await loadDecompressHandlers();
    await scanWithIndexCache(readableOf(bytes), handlers);
    const scanner = await scanWithIndexCache(readableOf(bytes), handlers);

    expect(scan).toHaveBeenCalledTimes(2);
    expect(scanner.messageCount).toBe(2n);
  });
});
