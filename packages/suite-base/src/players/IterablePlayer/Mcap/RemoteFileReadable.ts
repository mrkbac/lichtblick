// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { McapTypes } from "@mcap/core";
import { Semaphore } from "async-mutex";

import BrowserHttpReader from "@lichtblick/suite-base/util/BrowserHttpReader";
import CachedFilelike from "@lichtblick/suite-base/util/CachedFilelike";

import { BatchingReadable } from "./BatchingReadable";
import type { RemoteFileReadableOptions } from "./RemoteFileReadable.types";

const DEFAULT_CACHE_SIZE_BYTES = 1024 * 1024 * 500; // 500MiB
// Parallel range requests hide per-request latency; a few saturate most links
const PREFETCH_CONCURRENCY = 4;
// ponytail: FIFO eviction; switch to LRU if prefetched ranges get re-read after long gaps
const PREFETCH_MAX_BYTES = 1024 * 1024 * 128;
// While prefetches keep coming in, reads jump around: fetch misses exactly too instead of
// opening a streaming connection that reads ahead megabytes the next jump skips
const PREFETCH_ACTIVE_MS = 2000;

type Prefetched = { start: number; end: number; data: Promise<Uint8Array | undefined> };

export class RemoteFileReadable {
  readonly #remoteReader: CachedFilelike;
  readonly #batchingReadable: BatchingReadable;
  readonly #url: string;
  readonly #credentials: RequestCredentials | undefined;
  readonly #prefetchQueue = new Semaphore(PREFETCH_CONCURRENCY);
  // Exact-range downloads keyed by start offset, in request order for eviction
  readonly #prefetched = new Map<number, Prefetched>();
  #prefetchedBytes = 0;
  #lastPrefetchMs = 0;

  public constructor(url: string, options?: RemoteFileReadableOptions) {
    this.#url = url;
    this.#credentials = options?.credentials;
    const fileReader = new BrowserHttpReader(url, { credentials: this.#credentials });
    this.#remoteReader = new CachedFilelike({
      fileReader,
      cacheSizeInBytes: options?.cacheSizeInBytes ?? DEFAULT_CACHE_SIZE_BYTES,
      readAheadEnabled: options?.readAheadEnabled,
      readAheadBufferBytes: options?.readAheadBufferBytes,
    });

    const inner: McapTypes.IReadable = {
      size: async () => BigInt(this.#remoteReader.size()),
      read: async (offset, size) => {
        if (offset + size > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error(`Read too large: offset ${offset}, size ${size}`);
        }
        return await this.#remoteReader.read(Number(offset), Number(size));
      },
    };
    this.#batchingReadable = new BatchingReadable(inner);
  }

  public async open(): Promise<void> {
    await this.#remoteReader.open(); // Important that we call this first, because it might throw an error if the file can't be read.
  }

  public async size(): Promise<bigint> {
    return BigInt(this.#remoteReader.size());
  }
  public async read(offset: bigint, size: bigint): Promise<Uint8Array> {
    const start = Number(offset);
    const end = start + Number(size);
    let prefetched = this.#findPrefetched(start, end);
    if (!prefetched && Date.now() - this.#lastPrefetchMs < PREFETCH_ACTIVE_MS) {
      this.prefetch([{ offset, length: size }]);
      prefetched = this.#findPrefetched(start, end);
    }
    const data = await prefetched?.data;
    if (prefetched && data) {
      return data.subarray(start - prefetched.start, end - prefetched.start);
    }
    return await this.#batchingReadable.read(offset, size);
  }

  #findPrefetched(start: number, end: number): Prefetched | undefined {
    for (const prefetched of this.#prefetched.values()) {
      if (prefetched.start <= start && end <= prefetched.end) {
        return prefetched;
      }
    }
    return undefined;
  }

  /**
   * Download these exact ranges in parallel, without the cache's read-ahead, so reads that jump
   * around (e.g. skimming at high playback speed) don't each wait for a request round trip or
   * stream megabytes they skip. Failed prefetches fall back to the normal read path.
   */
  public prefetch(ranges: { offset: bigint; length: bigint }[]): void {
    this.#lastPrefetchMs = Date.now();
    for (const range of ranges) {
      const start = Number(range.offset);
      const end = start + Number(range.length);
      if (this.#prefetched.has(start)) {
        continue;
      }
      const data = this.#prefetchQueue
        .runExclusive(async () => await this.#fetchRange(start, end))
        .catch(() => undefined);
      this.#prefetched.set(start, { start, end, data });
      this.#prefetchedBytes += end - start;
      for (const [key, oldest] of this.#prefetched) {
        if (this.#prefetchedBytes <= PREFETCH_MAX_BYTES) {
          break;
        }
        this.#prefetched.delete(key);
        this.#prefetchedBytes -= oldest.end - oldest.start;
      }
    }
  }

  async #fetchRange(start: number, end: number): Promise<Uint8Array | undefined> {
    const controller = new AbortController();
    const response = await fetch(this.#url, {
      headers: { range: `bytes=${start}-${end - 1}` },
      credentials: this.#credentials,
      signal: controller.signal,
    });
    if (response.status !== 206) {
      // The server ignored the range; don't download the whole file
      controller.abort();
      return undefined;
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  public close(): void {
    this.#prefetched.clear();
    this.#prefetchedBytes = 0;
    this.#remoteReader.close();
  }
}
