// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@foxglove/rostime";
import { McapIndexedReader, McapTypes } from "@mcap/core";

import Log from "@lichtblick/log";
import { loadDecompressHandlers } from "@lichtblick/mcap-support";
import { MessageEvent } from "@lichtblick/suite-base/players/types";
import { toError } from "@lichtblick/suite-base/util/toError";

import { BlobReadable } from "./BlobReadable";
import { McapIndexedIterableSource, RecoverReader } from "./McapIndexedIterableSource";
import type {
  HydratedInner,
  IndexedReaderResult,
  McapSource,
  OpenedInner,
} from "./McapIterableSource.types";
import { McapRecoveryScanner } from "./McapRecoveryScanner";
import { McapUnindexedIterableSource } from "./McapUnindexedIterableSource";
import { RemoteFileReadable } from "./RemoteFileReadable";
import { READER_BASE_BYTES, estimateReaderWeightBytes } from "./readerWeight";
import {
  IteratorResult,
  Initialization,
  MessageIteratorArgs,
  GetBackfillMessagesArgs,
  ISerializedIterableSource,
} from "../IIterableSource";
import { HydratedSourcePool, SourceHydrator } from "../shared/HydratedSourcePool";

const log = Log.getLogger(__filename);

/**
 * Create a McapIndexedReader if it will be possible to do an indexed read. A file without a usable
 * summary (no footer, cut off, corrupt summary) or that fails indexed initialization in any other
 * way is reported as "recover": it gets a forward scan instead (see McapRecoveryScanner). I/O
 * errors fail that scan too and surface as real errors.
 */
async function tryCreateIndexedReader(
  readable: McapTypes.IReadable,
  decompressHandlers: McapTypes.DecompressHandlers,
): Promise<IndexedReaderResult> {
  let reader: McapIndexedReader;
  try {
    reader = await McapIndexedReader.Initialize({
      readable,
      decompressHandlers,
    });
  } catch (err: unknown) {
    return { status: "recover", error: toError(err) };
  }

  if (reader.chunkIndexes.length === 0 || reader.channelsById.size === 0) {
    // Parsed successfully but genuinely has no index data (e.g. an empty recording).
    return { status: "unindexed" };
  }
  return { status: "indexed", reader };
}

export class McapIterableSource implements ISerializedIterableSource {
  #source: McapSource;
  // Eagerly-retained inner: used for local blobs, unindexed streams, and unpooled sources.
  #eagerInner: ISerializedIterableSource | undefined;
  // Set when this source is managed by a bounded LRU pool (re-hydrated on demand).
  #pool: HydratedSourcePool | undefined;
  #start?: Time;
  #end?: Time;
  // Session-persistent remote connection + byte cache for `type: "url"` indexed sources.
  // Created once (on first hydration) and reused across every subsequent re-hydration, so pool
  // eviction only discards the heavyweight indexed-reader/parsed-channel state. Closed only in
  // terminate(). Undefined for "file" sources and for remote sources that fail indexed init or
  // fall back to eager unindexed streaming.
  #persistentReadable: RemoteFileReadable | undefined;
  // Index rebuilt by a forward scan, for files without a usable summary or with corrupt chunks
  #recovery: McapRecoveryScanner | undefined;

  public readonly sourceType = "serialized";

  public constructor(source: McapSource) {
    this.#source = source;
  }

  // Build a fresh inner source. Returns the readable for remote sources so it can be closed later.
  async #openInner(): Promise<OpenedInner> {
    const source = this.#source;

    // Preload decompression handlers so WASM is ready before any read that needs it.
    const decompressHandlers = await loadDecompressHandlers();

    switch (source.type) {
      case "file":
        return await this.#openFileSource(source, decompressHandlers);
      case "url":
        return await this.#openUrlSource(source, decompressHandlers);
    }
  }

  async #openFileSource(
    source: Extract<McapSource, { type: "file" }>,
    decompressHandlers: McapTypes.DecompressHandlers,
  ): Promise<OpenedInner> {
    // Ensure the file is readable before proceeding (will throw in the event of a permission
    // error). Workaround for the fact that `file.stream().getReader()` returns a generic
    // "network error" in the event of a permission error.
    await source.file.slice(0, 1).arrayBuffer();

    const readable = new BlobReadable(source.file);
    const result = await this.#openReader(readable, decompressHandlers);
    if (result.status === "indexed") {
      return {
        inner: new McapIndexedIterableSource(result.reader, {
          recover: this.#recoverer(readable, decompressHandlers),
        }),
        indexed: true,
        weightBytes: estimateReaderWeightBytes(result.reader),
      };
    }
    const file = result.length != undefined ? source.file.slice(0, result.length) : source.file;
    return {
      inner: new McapUnindexedIterableSource({ size: file.size, stream: file.stream() }),
      indexed: false,
      weightBytes: READER_BASE_BYTES,
    };
  }

  async #openUrlSource(
    source: Extract<McapSource, { type: "url" }>,
    decompressHandlers: McapTypes.DecompressHandlers,
  ): Promise<OpenedInner> {
    let readable = this.#persistentReadable;
    if (!readable) {
      readable = new RemoteFileReadable(source.url, {
        cacheSizeInBytes: source.cacheSizeInBytes,
        readAheadEnabled: source.readAheadEnabled,
        ...(source.readAheadBufferBytes != undefined
          ? { readAheadBufferBytes: source.readAheadBufferBytes }
          : {}),
      });
      await readable.open();
      this.#persistentReadable = readable;
    }
    let result;
    try {
      result = await this.#openReader(readable, decompressHandlers);
    } catch (error) {
      // A real failure (e.g. a network error) must not be masked by re-fetching the whole file via
      // the eager, unbounded streaming fallback — surface the actual error.
      readable.close();
      this.#persistentReadable = undefined;
      throw error;
    }
    if (result.status === "indexed") {
      const remote = readable;
      return {
        inner: new McapIndexedIterableSource(result.reader, {
          prefetch: (ranges) => {
            // A rebuilt index keeps message indexes in memory past the end of the real bytes
            const end = this.#recovery?.offset;
            remote.prefetch(
              end == undefined
                ? ranges
                : ranges.flatMap(({ offset, length }) =>
                    offset < end
                      ? [{ offset, length: offset + length > end ? end - offset : length }]
                      : [],
                  ),
            );
          },
          recover: this.#recoverer(readable, decompressHandlers),
        }),
        readable,
        indexed: true,
        weightBytes: estimateReaderWeightBytes(result.reader),
      };
    }
    // Unindexed remote fallback: single-pass streaming read of the whole file. This path
    // bypasses the pool entirely and never re-hydrates, so there is no benefit in keeping the
    // indexed-init probe connection/cache alive.
    readable.close();
    this.#persistentReadable = undefined;
    return await this.#openUnindexedUrlFallback(source.url, result.length);
  }

  /**
   * An indexed reader for the file: from its own summary when that works, otherwise from an index
   * rebuilt by a forward scan (kept for re-hydration, so the scan runs once per session).
   * "unindexed" means stream it instead; `length` limits the stream to the readable records.
   */
  async #openReader(
    readable: McapTypes.IReadable,
    decompressHandlers: McapTypes.DecompressHandlers,
  ): Promise<
    { status: "indexed"; reader: McapIndexedReader } | { status: "unindexed"; length?: number }
  > {
    if (!this.#recovery) {
      const result = await tryCreateIndexedReader(readable, decompressHandlers);
      if (result.status !== "recover") {
        return result;
      }
      this.#recovery = await scanForRecovery(readable, decompressHandlers, result.error);
    }
    if (this.#recovery.recoveredChunkCount() === 0) {
      // Nothing chunked (e.g. messages written without chunks): stream the readable part.
      return { status: "unindexed", length: Number(this.#recovery.offset) };
    }
    return {
      status: "indexed",
      reader: await McapIndexedReader.Initialize({
        readable: this.#recovery.toReadable(readable),
        decompressHandlers,
      }),
    };
  }

  /**
   * For an indexed reader that throws while reading (e.g. a chunk with a bad CRC in an otherwise
   * complete file): rebuild the index from a scan, which skips the corrupt chunks.
   */
  #recoverer(
    readable: McapTypes.IReadable,
    decompressHandlers: McapTypes.DecompressHandlers,
  ): RecoverReader | undefined {
    if (this.#recovery) {
      return undefined; // already built from a scan that validated every chunk
    }
    return async (error) => {
      this.#recovery ??= await scanForRecovery(readable, decompressHandlers, error);
      const reader = await McapIndexedReader.Initialize({
        readable: this.#recovery.toReadable(readable),
        decompressHandlers,
      });
      // Nothing lost means the summary was fine and the read error came from elsewhere (e.g. the
      // network); reading resumes on the rebuilt index without claiming the file was damaged.
      return { reader, alert: this.#recovery.hasLosses() ? this.#recovery.toAlert() : undefined };
    };
  }

  /** `length` limits the stream to the readable records of a damaged file */
  async #openUnindexedUrlFallback(url: string, length?: number): Promise<OpenedInner> {
    const response = await fetch(url);
    if (!response.body) {
      throw new Error(`Unable to stream remote file. <${url}>`);
    }
    const size = response.headers.get("content-length");
    if (size == undefined) {
      throw new Error(`Remote file is missing Content-Length header. <${url}>`);
    }
    return {
      inner: new McapUnindexedIterableSource({
        size: length ?? Number.parseInt(size, 10),
        stream: length == undefined ? response.body : response.body.pipeThrough(firstBytes(length)),
      }),
      indexed: false,
      weightBytes: READER_BASE_BYTES,
    };
  }

  // Pool hydrator: builds a ready-to-iterate indexed inner (channels parsed). The underlying
  // remote readable/connection is session-persistent and intentionally survives pool eviction.
  readonly #hydrator: SourceHydrator<HydratedInner> = {
    open: async () => {
      const { inner, readable, weightBytes } = await this.#openInner();
      await inner.initialize();
      return { inner, readable, weightBytes };
    },
    close: async (_value) => {
      // The underlying RemoteFileReadable/connection is session-persistent (see
      // #persistentReadable) and is intentionally NOT closed here. Eviction only discards the
      // heavyweight indexed-reader/parsed-channel structures, which are rebuilt on the next
      // acquire() from the already-open, already-cached remote source.
    },
    weigh: ({ weightBytes }) => weightBytes,
  };

  public async initialize(): Promise<Initialization> {
    const opened = await this.#openInner();
    const init = await opened.inner.initialize();
    if (this.#recovery) {
      init.alerts = [this.#recovery.toAlert(), ...init.alerts];
    }
    this.#start = init.start;
    this.#end = init.end;

    const pool = this.#source.pool;
    if (pool && opened.indexed) {
      this.#pool = pool;
      // Seed the pool with the already-hydrated inner (no redundant open). May be evicted+closed
      // immediately if the pool is already at capacity.
      await pool.admit(this, this.#hydrator, {
        inner: opened.inner,
        readable: opened.readable,
        weightBytes: opened.weightBytes,
      });
    } else {
      // Unindexed (and unpooled) sources are retained eagerly for the whole session and are NOT
      // bounded by the pool. A session of many large unindexed MCAPs can therefore grow unbounded;
      // pooling them is non-trivial because re-hydration would re-stream the entire file.
      this.#eagerInner = opened.inner;
    }
    if (init.recordingFiles) {
      const sizeBytes =
        this.#source.type === "file"
          ? this.#source.file.size
          : Number(await opened.readable?.size());
      const { start, end } = init;
      const name = sourceName(this.#source);
      init.recordingFiles = init.recordingFiles.map((file) => ({
        ...file,
        name,
        start,
        end,
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : undefined,
      }));
    }
    return init;
  }

  public async *messageIterator(
    opt: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> {
    // NOTE: this is an async generator, so the "uninitialized" invariant below throws on the first
    // .next() call, not when messageIterator() is invoked. Callers that expect a synchronous throw
    // (mergeSequentialIterators calls .next(), so it surfaces there) should account for this.
    if (!this.#pool) {
      if (!this.#eagerInner) {
        throw new Error("Invariant: uninitialized");
      }
      yield* this.#eagerInner.messageIterator(opt);
      return;
    }
    const { inner } = await this.#pool.acquire(this, this.#hydrator);
    try {
      yield* inner.messageIterator(opt);
    } finally {
      this.#pool.release(this);
    }
  }

  public async getBackfillMessages(
    args: GetBackfillMessagesArgs,
  ): Promise<MessageEvent<Uint8Array>[]> {
    if (!this.#pool) {
      if (!this.#eagerInner) {
        throw new Error("Invariant: uninitialized");
      }
      return await this.#eagerInner.getBackfillMessages(args);
    }
    const { inner } = await this.#pool.acquire(this, this.#hydrator);
    try {
      return await inner.getBackfillMessages(args);
    } finally {
      this.#pool.release(this);
    }
  }

  public getStart(): Time | undefined {
    return this.#start;
  }

  public getEnd(): Time | undefined {
    return this.#end;
  }

  // Warm this source into the pool (resident + most-recently-used) without holding a pin, so the
  // earliest-by-start sources are ready before playback begins. No-op for unpooled sources.
  public async prewarm(): Promise<void> {
    if (!this.#pool) {
      return;
    }
    await this.#pool.acquire(this, this.#hydrator);
    this.#pool.release(this);
  }

  public async terminate(): Promise<void> {
    // Pooled inners are torn down by the pool (owned by MultiIterableSource); only release an
    // eagerly-retained inner here.
    await this.#eagerInner?.terminate?.();
    // The pool's hydrator.close() intentionally does not close this — it is session-persistent
    // (see #persistentReadable) and is only closed when the whole source is torn down.
    this.#persistentReadable?.close();
    this.#persistentReadable = undefined;
  }
}

async function scanForRecovery(
  readable: McapTypes.IReadable,
  decompressHandlers: McapTypes.DecompressHandlers,
  originalError: Error,
): Promise<McapRecoveryScanner> {
  const scanner = new McapRecoveryScanner(decompressHandlers);
  try {
    await scanner.scan(readable);
  } catch (scanError) {
    // Not an MCAP file, or the bytes can't be read at all: the original error says more.
    log.error(originalError, scanError);
    throw originalError;
  }
  log.info(`Recovered MCAP index after: ${originalError.message}`);
  return scanner;
}

/** Passes through the first `length` bytes of a stream and drops the rest */
function firstBytes(length: number): TransformStream<Uint8Array, Uint8Array> {
  let remaining = length;
  return new TransformStream({
    transform(chunk, controller) {
      if (remaining > 0) {
        controller.enqueue(chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk);
        remaining -= chunk.byteLength;
      }
    },
  });
}

function sourceName(source: McapSource): string | undefined {
  if (source.type === "file") {
    return source.file instanceof File ? source.file.name : undefined;
  }
  const lastSegment = source.url.split(/[?#]/, 1)[0]?.split("/").pop();
  if (!lastSegment) {
    return undefined;
  }
  try {
    return decodeURIComponent(lastSegment);
  } catch {
    // Malformed percent-encoding: show the segment as-is.
    return lastSegment;
  }
}
