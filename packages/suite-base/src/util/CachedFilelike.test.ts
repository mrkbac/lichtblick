// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import delay from "@lichtblick/suite-base/util/delay";

import CachedFilelike from "./CachedFilelike";
import type { FileReader, FileStream } from "./CachedFilelike.types";

const MEBIBYTE = 1024 * 1024;

class InMemoryFileReader implements FileReader {
  #buffer: Uint8Array;

  public constructor(bufferObj: Uint8Array) {
    this.#buffer = bufferObj;
  }

  public async open() {
    return { size: this.#buffer.byteLength };
  }

  public fetch(offset: number, length: number): FileStream {
    if (offset + length > this.#buffer.byteLength) {
      throw new Error(
        `Read offset=${offset} length=${length} past buffer length ${this.#buffer.byteLength}`,
      );
    }
    return {
      on: (
        type: "data" | "error" | "end",
        callback: ((_: Uint8Array) => void) & ((_: Error) => void) & (() => void),
      ) => {
        if (type === "data") {
          setTimeout(() => {
            callback(this.#buffer.slice(offset, offset + length));
          }, 0);
        }
      },
      destroy() {
        // no-op
      },
    };
  }
}

const log = {
  debug: (..._args: unknown[]) => {},
  info: (..._args: unknown[]) => {},
  warn: (..._args: unknown[]) => {},
  error: (..._args: unknown[]) => {},
};

describe("CachedFilelike", () => {
  describe("#size", () => {
    it("returns the size from the underlying FileReader", async () => {
      const fileReader = new InMemoryFileReader(new Uint8Array([0, 1, 2, 3]));
      const cachedFileReader = new CachedFilelike({ fileReader, log });
      await cachedFileReader.open();
      expect(cachedFileReader.size()).toEqual(4);
    });

    it("does not throw when the size is 0", async () => {
      const fileReader = new InMemoryFileReader(new Uint8Array([]));
      const cachedFileReader = new CachedFilelike({ fileReader, log });
      await cachedFileReader.open();
      expect(cachedFileReader.size()).toEqual(0);
    });
  });

  describe("#read", () => {
    it("returns data from the underlying FileReader", async () => {
      const fileReader = new InMemoryFileReader(new Uint8Array([0, 1, 2, 3]));
      const cachedFileReader = new CachedFilelike({ fileReader, log });
      await expect(cachedFileReader.read(1, 2)).resolves.toEqual(new Uint8Array([1, 2]));
      await expect(cachedFileReader.read(2, 2)).resolves.toEqual(new Uint8Array([2, 3]));
    });

    it("requests only the exact range when read-ahead is disabled", async () => {
      // GIVEN: a file that fits entirely in the cache.
      const fileReader = new InMemoryFileReader(new Uint8Array(100));
      const fetch = jest.spyOn(fileReader, "fetch");
      const cachedFileReader = new CachedFilelike({
        fileReader,
        cacheSizeInBytes: 100,
        readAheadEnabled: false,
        log,
      });

      // WHEN: reading a small range.
      await expect(cachedFileReader.read(0, 10)).resolves.toEqual(new Uint8Array(10));

      // THEN: no speculative whole-file or look-ahead fetch is made.
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(0, 10);
    });

    it("bounds speculative fetch length with readAheadBufferBytes", async () => {
      // GIVEN: a large remote-like file with a small cache budget and a much smaller read-ahead cap.
      const readAheadBufferBytes = 2 * 1024 * 1024;
      const fetch = jest.fn(
        (_offset: number, length: number): FileStream => ({
          on: (
            type: "data" | "error" | "end",
            callback: ((_: Uint8Array) => void) & ((_: Error) => void) & (() => void),
          ) => {
            if (type === "data") {
              setTimeout(() => {
                callback(new Uint8Array(length));
              }, 0);
            }
          },
          destroy() {
            // no-op
          },
        }),
      );
      const fileReader: FileReader = {
        open: async () => ({ size: 100 * 1024 * 1024 }),
        fetch,
      };
      const cachedFileReader = new CachedFilelike({
        fileReader,
        cacheSizeInBytes: 10 * 1024 * 1024,
        readAheadBufferBytes,
        log,
      });

      // WHEN: reading a small initial range.
      await expect(cachedFileReader.read(0, 1024)).resolves.toEqual(new Uint8Array(1024));

      // THEN: the initial underlying fetch uses the bounded read-ahead size instead of 50 MiB.
      expect(fetch).toHaveBeenNthCalledWith(1, 0, readAheadBufferBytes);
    });

    it("resolves a later overlapping read instead of hanging when a small read-ahead buffer trails cached bytes", async () => {
      // GIVEN: a file where an earlier 2 MiB speculative fetch is still in flight when a later
      // 4 MiB read arrives, matching the production hang scenario exposed by a 2 MiB buffer.
      const fetch = jest.fn(
        (_offset: number, length: number): FileStream => ({
          on: (
            type: "data" | "error" | "end",
            callback: ((_: Uint8Array) => void) & ((_: Error) => void) & (() => void),
          ) => {
            if (type === "data") {
              setTimeout(() => {
                callback(new Uint8Array(length));
              }, 25);
            }
          },
          destroy() {
            // no-op
          },
        }),
      );
      const fileReader: FileReader = {
        open: async () => ({ size: 8 * MEBIBYTE }),
        fetch,
      };
      const cachedFileReader = new CachedFilelike({
        fileReader,
        cacheSizeInBytes: 6 * MEBIBYTE,
        readAheadBufferBytes: 2 * MEBIBYTE,
        log,
      });

      const firstReadPromise = cachedFileReader.read(0, 1);
      await delay(10);
      expect(fetch).toHaveBeenCalledTimes(1);

      // WHEN: a larger overlapping read needs bytes beyond the already cached 2 MiB prefix.
      const secondReadPromise = cachedFileReader.read(0, 4 * MEBIBYTE);

      // THEN: the second fetch makes forward progress by requesting the missing 2 MiB tail
      // instead of issuing a degenerate 2 MiB-2 MiB range and hanging forever.
      await expect(firstReadPromise).resolves.toEqual(new Uint8Array([0]));
      await expect(secondReadPromise).resolves.toEqual(new Uint8Array(4 * MEBIBYTE));
      expect(fetch.mock.calls.slice(0, 2)).toEqual([
        [0, 2 * MEBIBYTE],
        [2 * MEBIBYTE, 2 * MEBIBYTE],
      ]);
    }, 2000);

    it("ignores a degenerate zero-width idle connection instead of fetching it", async () => {
      jest.resetModules();
      const getNewConnection = jest
        .fn()
        .mockReturnValueOnce({ start: 0, end: 4 })
        .mockReturnValueOnce({ start: 4, end: 4 })
        .mockReturnValue(undefined);
      jest.doMock("./getNewConnection", () => ({
        getNewConnection,
      }));
      const { default: MockedCachedFilelike } = await import("./CachedFilelike");

      const fileReader = new InMemoryFileReader(new Uint8Array([0, 1, 2, 3]));
      const fetch = jest.spyOn(fileReader, "fetch");
      const debug = jest.fn();
      const cachedFileReader = new MockedCachedFilelike({
        fileReader,
        log: { ...log, debug },
      });

      try {
        await expect(cachedFileReader.read(0, 4)).resolves.toEqual(new Uint8Array([0, 1, 2, 3]));
        await delay(10);

        expect(getNewConnection).toHaveBeenCalledTimes(2);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith(0, 4);
        expect(debug).toHaveBeenCalledWith(expect.stringContaining("Ignoring degenerate"));
      } finally {
        jest.dontMock("./getNewConnection");
        jest.resetModules();
      }
    });

    it("reads the exact range uncached when a single read exceeds the cache size", async () => {
      // GIVEN: a source allocated a small cache (mirrors a many-file remote session where each
      // source receives only the 10 MiB minimum floor) backed by a larger file.
      const sourceData = Uint8Array.from({ length: 100 }, (_, index) => index);
      const fileReader = new InMemoryFileReader(sourceData);
      const cachedFileReader = new CachedFilelike({ fileReader, cacheSizeInBytes: 10, log });

      // WHEN: a chunk read is larger than the cache.
      const result = await cachedFileReader.read(0, 20);

      // THEN: the exact bytes are returned via the uncached path.
      expect(result).toEqual(sourceData.slice(0, 20));
    });

    it("rejects when an uncached read exceeds the file size", async () => {
      // GIVEN: a small file and a cache smaller than the requested read.
      const fileReader = new InMemoryFileReader(new Uint8Array(10));
      const cachedFileReader = new CachedFilelike({ fileReader, cacheSizeInBytes: 5, log });

      // WHEN/THEN: an oversized read that extends past EOF still rejects with the normal
      // out-of-bounds error.
      await expect(cachedFileReader.read(0, 1000)).rejects.toThrow("CachedFilelike#read past size");
    });

    it("returns an error in the callback if the FileReader keeps returning errors", async () => {
      const fileReader = new InMemoryFileReader(new Uint8Array([0, 1, 2, 3]));
      let interval: any;
      let destroyed: any;
      jest.spyOn(fileReader, "fetch").mockImplementation(() => {
        return {
          on: (
            type: "data" | "error" | "end",
            callback: ((_: Uint8Array) => void) & ((_: Error) => void) & (() => void),
          ) => {
            if (type === "error") {
              interval = setInterval(() => {
                callback(new Error("Dummy error"));
              }, 20);
            }
          },
          destroy() {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            clearInterval(interval);
            destroyed = true;
          },
        };
      });
      const cachedFileReader = new CachedFilelike({ fileReader, log });
      await expect(cachedFileReader.read(1, 2)).rejects.toThrow("Dummy error");
      expect(destroyed).toEqual(true);
    });

    it("keeps reconnecting when keepReconnectingCallback is set", async () => {
      const fileReader = new InMemoryFileReader(new Uint8Array([0, 1, 2, 3]));
      let dataCallback: ((_: Uint8Array) => void) | undefined;
      let errorCallback: ((_: Error) => void) | undefined;
      let destroyed: any;
      const mockFetch = jest.spyOn(fileReader, "fetch").mockImplementation(() => {
        return {
          on: (
            type: "data" | "error" | "end",
            callback: ((_: Uint8Array) => void) & ((_: Error) => void) & (() => void),
          ) => {
            if (type === "data") {
              dataCallback = callback;
            }
            if (type === "error") {
              errorCallback = callback;
            }
          },
          destroy() {
            destroyed = true;
          },
        };
      });

      const keepReconnectingCallback = jest.fn();
      const cachedFileReader = new CachedFilelike({ fileReader, log, keepReconnectingCallback });

      const readerPromise = cachedFileReader.read(1, 2);

      await delay(10);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      if (!dataCallback || !errorCallback) {
        throw new Error("dataCallback not set");
      }
      errorCallback(new Error("Dummy error"));
      await delay(10);
      expect(keepReconnectingCallback.mock.calls).toEqual([[true]]);

      dataCallback(new Uint8Array([1, 2]));
      const data = await readerPromise;
      expect(keepReconnectingCallback.mock.calls).toEqual([[true], [false]]);
      expect([...data]).toEqual([1, 2]);
      expect(destroyed).toBe(true);
    });

    it("returns an empty buffer when requesting size 0 (does not throw an error)", async () => {
      const fileReader = new InMemoryFileReader(new Uint8Array([0, 1, 2, 3]));
      const cachedFileReader = new CachedFilelike({ fileReader, log });
      await expect(cachedFileReader.read(1, 0)).resolves.toEqual(new Uint8Array([]));
    });

    it("rejects instead of hanging when a cached connection ends before the requested range is fully downloaded", async () => {
      // GIVEN: a cached read whose underlying stream ends early twice in a row.
      const fetch = jest.fn(
        (_offset: number, length: number): FileStream => ({
          on: (
            type: "data" | "error" | "end",
            callback: ((_: Uint8Array) => void) & ((_: Error) => void) & (() => void),
          ) => {
            if (type === "data" && length > 1) {
              setTimeout(() => {
                callback(new Uint8Array(length - 1));
              }, 0);
            }
            if (type === "end") {
              setTimeout(() => {
                callback();
              }, 1);
            }
          },
          destroy() {
            // no-op
          },
        }),
      );
      const fileReader: FileReader = {
        open: async () => ({ size: 100 }),
        fetch,
      };
      const cachedFileReader = new CachedFilelike({
        fileReader,
        readAheadEnabled: false,
        log,
      });

      // WHEN / THEN: the read rejects after the early EOF retry path rather than staying
      // pending forever with no further network activity.
      await expect(cachedFileReader.read(0, 10)).rejects.toThrow(/ended before download completed/);
      expect(fetch).toHaveBeenCalledTimes(2);
    }, 1000);
  });

  describe("read ordering", () => {
    // A reader whose streams only deliver data when the test pushes it.
    function manualFileReader(size: number) {
      const streams: {
        offset: number;
        destroyed: boolean;
        onData?: (chunk: Uint8Array) => void;
        onError?: (error: Error) => void;
      }[] = [];
      const fileReader: FileReader = {
        open: async () => ({ size }),
        fetch: (offset: number): FileStream => {
          const stream: (typeof streams)[number] = { offset, destroyed: false };
          streams.push(stream);
          return {
            on: (
              type: "data" | "error" | "end",
              callback: ((_: Uint8Array) => void) & ((_: Error) => void) & (() => void),
            ) => {
              if (type === "data") {
                stream.onData = callback;
              } else if (type === "error") {
                stream.onError = callback;
              }
            },
            destroy: () => {
              stream.destroyed = true;
            },
          };
        },
      };
      const push = (bytes: number) => {
        streams[0]!.onData!(new Uint8Array(bytes));
      };
      return { fileReader, streams, push };
    }

    it("keeps the main connection and fetches a far read separately while it is in use", async () => {
      // GIVEN: a main connection that is serving reads near the start of a large file
      const now = jest.spyOn(Date, "now").mockReturnValue(0);
      const { fileReader, streams, push } = manualFileReader(200 * MEBIBYTE);
      const cachedFileReader = new CachedFilelike({
        fileReader,
        cacheSizeInBytes: 100 * MEBIBYTE,
        log,
      });
      const near = cachedFileReader.read(0, MEBIBYTE);
      await delay(0);
      push(MEBIBYTE);
      await near;

      // WHEN: a far read arrives
      const far = cachedFileReader.read(150 * MEBIBYTE, MEBIBYTE);
      await delay(0);

      // THEN: it gets its own fetch and the main connection is not destroyed
      expect(streams.map((stream) => [stream.offset, stream.destroyed])).toEqual([
        [0, false],
        [150 * MEBIBYTE, false],
      ]);
      streams[1]!.onData!(new Uint8Array(MEBIBYTE));
      await expect(far).resolves.toHaveLength(MEBIBYTE);

      // and the main connection keeps serving nearby reads
      const nearAgain = cachedFileReader.read(MEBIBYTE, MEBIBYTE);
      await delay(0);
      streams[0]!.onData!(new Uint8Array(MEBIBYTE));
      await expect(nearAgain).resolves.toHaveLength(MEBIBYTE);
      expect(streams).toHaveLength(2);
      now.mockRestore();
    });

    it("keeps a new main connection when a far read arrives before its first read resolves", async () => {
      // GIVEN: a main connection opened for a read that has not resolved yet
      const now = jest.spyOn(Date, "now").mockReturnValue(10_000);
      const { fileReader, streams, push } = manualFileReader(200 * MEBIBYTE);
      const cachedFileReader = new CachedFilelike({
        fileReader,
        cacheSizeInBytes: 100 * MEBIBYTE,
        log,
      });
      const near = cachedFileReader.read(0, MEBIBYTE);
      await delay(0);

      // WHEN: a far read arrives
      void cachedFileReader.read(150 * MEBIBYTE, MEBIBYTE);
      await delay(0);

      // THEN: the far read gets its own fetch and the main connection still serves the near read
      expect(streams.map((stream) => [stream.offset, stream.destroyed])).toEqual([
        [0, false],
        [150 * MEBIBYTE, false],
      ]);
      push(MEBIBYTE);
      await expect(near).resolves.toHaveLength(MEBIBYTE);
      now.mockRestore();
    });

    it("does not retry a failed side fetch in a loop", async () => {
      // GIVEN: a far read served by a side fetch while the main connection is in use
      const now = jest.spyOn(Date, "now").mockReturnValue(0);
      const { fileReader, streams, push } = manualFileReader(200 * MEBIBYTE);
      const cachedFileReader = new CachedFilelike({
        fileReader,
        cacheSizeInBytes: 100 * MEBIBYTE,
        log,
      });
      const near = cachedFileReader.read(0, MEBIBYTE);
      await delay(0);
      push(MEBIBYTE);
      await near;
      void cachedFileReader.read(150 * MEBIBYTE, MEBIBYTE);
      await delay(0);

      // WHEN: the side fetch fails
      streams[1]!.onError!(new Error("network"));
      await delay(0);

      // THEN: the read is left to the main connection instead of starting another side fetch
      expect(streams).toHaveLength(2);
      now.mockRestore();
    });

    it("moves the main connection to a far read once it is idle", async () => {
      // GIVEN: a main connection that last served a read a while ago
      const { fileReader, streams, push } = manualFileReader(200 * MEBIBYTE);
      const cachedFileReader = new CachedFilelike({
        fileReader,
        cacheSizeInBytes: 100 * MEBIBYTE,
        log,
      });
      const now = jest.spyOn(Date, "now").mockReturnValue(0);
      const near = cachedFileReader.read(0, MEBIBYTE);
      await delay(0);
      push(MEBIBYTE);
      await near;
      now.mockReturnValue(10_000);

      // WHEN: a far read arrives (e.g. after a seek)
      void cachedFileReader.read(150 * MEBIBYTE, MEBIBYTE);
      await delay(0);

      // THEN: the main connection moves there
      expect(streams.map((stream) => [stream.offset, stream.destroyed])).toEqual([
        [0, true],
        [150 * MEBIBYTE, false],
      ]);
      now.mockRestore();
    });
  });

  describe("#close", () => {
    it("rejects reads after close()", async () => {
      // GIVEN: an opened reader.
      const fileReader = new InMemoryFileReader(new Uint8Array([0, 1, 2, 3]));
      const cachedFileReader = new CachedFilelike({ fileReader, log });
      await cachedFileReader.open();

      // WHEN: the reader is closed.
      cachedFileReader.close();

      // THEN: subsequent reads reject with the closed error.
      await expect(cachedFileReader.read(0, 2)).rejects.toThrow("CachedFilelike is closed");
    });

    it("is idempotent when called twice", () => {
      // GIVEN: a reader.
      const fileReader = new InMemoryFileReader(new Uint8Array([0, 1, 2, 3]));
      const cachedFileReader = new CachedFilelike({ fileReader, log });

      // WHEN/THEN: closing twice does not throw.
      expect(() => {
        cachedFileReader.close();
        cachedFileReader.close();
      }).not.toThrow();
    });

    it("rejects an in-flight pending read request", async () => {
      // GIVEN: a file reader whose fetch never delivers data, so the read stays pending.
      const fileReader = new InMemoryFileReader(new Uint8Array([0, 1, 2, 3]));
      jest.spyOn(fileReader, "fetch").mockImplementation(() => ({
        on: () => {
          // Never emits "data" or "error", leaving the read request pending.
        },
        destroy() {
          // no-op
        },
      }));
      const cachedFileReader = new CachedFilelike({ fileReader, log });

      // WHEN: a read is started (and stays pending) and then the reader is closed.
      const readPromise = cachedFileReader.read(0, 2);
      await delay(10);
      cachedFileReader.close();

      // THEN: the pending read rejects with the closed error.
      await expect(readPromise).rejects.toThrow("CachedFilelike is closed");
    });

    it("rejects an oversized uncached read when closed", async () => {
      // GIVEN: a small cache and a fetch that never delivers data, so an oversized (uncached)
      // read stays pending.
      const fileReader = new InMemoryFileReader(new Uint8Array(100));
      jest.spyOn(fileReader, "fetch").mockImplementation(() => ({
        on: () => {
          // Never emits "data", "end", or "error", leaving the uncached read pending.
        },
        destroy() {
          // no-op
        },
      }));
      const cachedFileReader = new CachedFilelike({ fileReader, cacheSizeInBytes: 10, log });
      await cachedFileReader.open();

      // WHEN: an oversized read (larger than the cache budget) is started, then the reader closes.
      const readPromise = cachedFileReader.read(0, 50);
      await delay(10);
      cachedFileReader.close();

      // THEN: the oversized uncached read settles by rejecting with the closed error.
      await expect(readPromise).rejects.toThrow("CachedFilelike is closed");
    });

    it("destroys the active connection when two quick stream errors trigger the fatal close path", async () => {
      // GIVEN: a read that reconnects once and then hits the fatal double-error close path.
      const fileReader = new InMemoryFileReader(new Uint8Array([0, 1, 2, 3]));
      const streams: Array<{ destroy: jest.Mock; error?: (_error: Error) => void }> = [];
      jest.spyOn(fileReader, "fetch").mockImplementation(() => {
        const stream = { destroy: jest.fn() };
        streams.push(stream);
        return {
          on: (
            type: "data" | "error" | "end",
            callback: ((_: Uint8Array) => void) & ((_: Error) => void) & (() => void),
          ) => {
            if (type === "error") {
              streams[streams.length - 1]!.error = callback;
            }
          },
          destroy: stream.destroy,
        };
      });
      let now = 1_000;
      const dateNow = jest.spyOn(Date, "now").mockImplementation(() => now);
      const cachedFileReader = new CachedFilelike({ fileReader, log });

      try {
        // WHEN: two connection errors happen within the fatal 100ms window.
        const readPromise = cachedFileReader.read(0, 2);
        await delay(10);

        now = 1_010;
        streams[0]!.error?.(new Error("transient"));
        await delay(10);

        now = 1_050;
        const fatalError = new Error("fatal");
        streams[1]!.error?.(fatalError);

        // THEN: the read rejects, and the active connection is destroyed as part of full cleanup.
        await expect(readPromise).rejects.toThrow("fatal");
        expect(streams[1]!.destroy).toHaveBeenCalledTimes(1);
      } finally {
        dateNow.mockRestore();
      }
    });
  });
});
