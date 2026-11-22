// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { McapTypes } from "@lichtblick/mcap-core";
import CachedFilelike from "@lichtblick/suite-base/util/CachedFilelike";

import { RemoteFileReadable } from "./RemoteFileReadable";

// Mock BrowserHttpReader and CachedFilelike so we never make real HTTP requests
const mockOpen = vi.fn().mockResolvedValue(undefined);
const mockSize = vi.fn().mockReturnValue(1024);
const mockRead = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
const mockClose = vi.fn();

vi.mock("@lichtblick/suite-base/util/CachedFilelike", () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        open: mockOpen,
        size: mockSize,
        read: mockRead,
        close: mockClose,
      };
    }),
  };
});

vi.mock("@lichtblick/suite-base/util/BrowserHttpReader", () => {
  return { default: vi.fn() };
});

describe("RemoteFileReadable", () => {
  const testUrl = "https://example.com/data.mcap";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should use default 500MiB cache size when none provided", () => {
      // Given a URL without custom cache size
      // When creating a RemoteFileReadable
      new RemoteFileReadable(testUrl);

      // Then CachedFilelike should be created with 500MiB default
      expect(CachedFilelike).toHaveBeenCalledWith(
        expect.objectContaining({ cacheSizeInBytes: 1024 * 1024 * 500 }),
      );
    });

    it("should use custom cache size when provided", () => {
      // Given a URL with a custom cache size
      const customSize = 1024 * 1024 * 100; // 100MiB

      // When creating a RemoteFileReadable
      new RemoteFileReadable(testUrl, { cacheSizeInBytes: customSize });

      // Then CachedFilelike should be created with the custom size
      expect(CachedFilelike).toHaveBeenCalledWith(
        expect.objectContaining({ cacheSizeInBytes: customSize }),
      );
    });

    it("should pass through readAheadBufferBytes when provided", () => {
      // Given a URL with a bounded read-ahead buffer override
      const readAheadBufferBytes = 2 * 1024 * 1024;

      // When creating a RemoteFileReadable
      new RemoteFileReadable(testUrl, { readAheadBufferBytes });

      // Then CachedFilelike should receive the same bounded read-ahead override
      expect(CachedFilelike).toHaveBeenCalledWith(
        expect.objectContaining({ readAheadBufferBytes }),
      );
    });
  });

  describe("open", () => {
    it("should delegate to CachedFilelike.open()", async () => {
      // Given a RemoteFileReadable instance
      const reader = new RemoteFileReadable(testUrl);

      // When calling open
      await reader.open();

      // Then it should delegate to the internal CachedFilelike
      expect(mockOpen).toHaveBeenCalledTimes(1);
    });
  });

  describe("size", () => {
    it("should return file size as BigInt", async () => {
      // Given a RemoteFileReadable whose underlying CachedFilelike reports size 1024
      const reader = new RemoteFileReadable(testUrl);

      // When getting the size
      const result = await reader.size();

      // Then it should return the size as a BigInt
      expect(result).toBe(BigInt(1024));
    });
  });

  describe("read", () => {
    it("should delegate to CachedFilelike.read() converting BigInt to Number", async () => {
      // Given a RemoteFileReadable instance
      const reader = new RemoteFileReadable(testUrl);

      // When reading data with BigInt offset and size
      const result = await reader.read(BigInt(100), BigInt(50));

      // Then it should call CachedFilelike.read with Number values
      expect(mockRead).toHaveBeenCalledWith(100, 50, { background: false });
      expect(result).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("should throw when offset + size exceeds MAX_SAFE_INTEGER", async () => {
      // Given a RemoteFileReadable instance
      const reader = new RemoteFileReadable(testUrl);

      // When reading with offset + size > MAX_SAFE_INTEGER
      // Then it should throw
      await expect(reader.read(BigInt(Number.MAX_SAFE_INTEGER), BigInt(1))).rejects.toThrow(
        "Read too large",
      );
    });
  });

  describe("setChunks", () => {
    // A chunk at 100..150 with its message indexes right after it, at 150..160
    const chunk = (overrides: Partial<McapTypes.ChunkIndex> = {}): McapTypes.ChunkIndex => ({
      messageStartTime: 0n,
      messageEndTime: 1n,
      chunkStartOffset: 100n,
      chunkLength: 50n,
      messageIndexOffsets: new Map([[1, 150n]]),
      messageIndexLength: 10n,
      compression: "",
      compressedSize: 0n,
      uncompressedSize: 0n,
      ...overrides,
    });

    it("reads a chunk's message indexes together with the chunk before them", async () => {
      mockRead.mockResolvedValueOnce(Uint8Array.from({ length: 60 }, (_, i) => 100 + i));
      const reader = new RemoteFileReadable(testUrl);
      reader.setChunks([chunk()]);

      const data = await reader.read(150n, 10n);

      expect(mockRead).toHaveBeenCalledWith(100, 60, { background: false });
      expect([...data]).toEqual([150, 151, 152, 153, 154, 155, 156, 157, 158, 159]);
    });

    it("reads other ranges as asked", async () => {
      const reader = new RemoteFileReadable(testUrl);
      reader.setChunks([chunk()]);

      await reader.read(151n, 9n);
      await reader.read(100n, 50n);

      expect(mockRead).toHaveBeenNthCalledWith(1, 151, 9, { background: false });
      expect(mockRead).toHaveBeenNthCalledWith(2, 100, 50, { background: false });
    });

    it("leaves out chunks whose message indexes don't follow them", async () => {
      const reader = new RemoteFileReadable(testUrl);
      reader.setChunks([chunk({ messageIndexOffsets: new Map([[1, 9000n]]) })]);

      await reader.read(150n, 10n);

      expect(mockRead).toHaveBeenCalledWith(150, 10, { background: false });
    });

    it("leaves out chunks too big for a quarter of the cache", async () => {
      const reader = new RemoteFileReadable(testUrl, { cacheSizeInBytes: 160 });
      reader.setChunks([chunk()]);

      await reader.read(150n, 10n);

      expect(mockRead).toHaveBeenCalledWith(150, 10, { background: false });
    });
  });

  describe("close", () => {
    it("should delegate to CachedFilelike.close()", () => {
      // Given a RemoteFileReadable instance
      const reader = new RemoteFileReadable(testUrl);

      // When calling close
      reader.close();

      // Then it should delegate to the internal CachedFilelike
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("prefetch", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    it("serves reads inside a prefetched range from one exact range request", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(new Uint8Array([10, 11, 12, 13, 14]), { status: 206 }));
      globalThis.fetch = fetchMock;
      const readable = new RemoteFileReadable(testUrl);

      readable.prefetch([{ offset: 100n, length: 5n }]);
      const data = await readable.read(101n, 3n);

      expect([...data]).toEqual([11, 12, 13]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        testUrl,
        expect.objectContaining({ headers: { range: "bytes=100-104" } }),
      );
      expect(mockRead).not.toHaveBeenCalled();
    });

    it("fetches misses exactly while skimming, and streams them after a one-off batch", async () => {
      const fetchMock = vi
        .fn()
        .mockImplementation(async () => new Response(new Uint8Array(5), { status: 206 }));
      globalThis.fetch = fetchMock;
      const skimming = new RemoteFileReadable(testUrl);
      const oneOff = new RemoteFileReadable(testUrl);

      skimming.prefetch([{ offset: 100n, length: 5n }]);
      oneOff.prefetch([{ offset: 100n, length: 5n }], { skim: false });
      await skimming.read(500n, 5n);
      await oneOff.read(500n, 5n);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(mockRead).toHaveBeenCalledTimes(1);
      expect(mockRead).toHaveBeenCalledWith(500, 5, { background: false });
    });

    it("falls back to the cached reader when the server ignores the range", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array(1024)));
      const readable = new RemoteFileReadable(testUrl);

      readable.prefetch([{ offset: 100n, length: 5n }]);
      const data = await readable.read(100n, 3n);

      expect([...data]).toEqual([1, 2, 3]);
      expect(mockRead).toHaveBeenCalled();
    });
  });
});
