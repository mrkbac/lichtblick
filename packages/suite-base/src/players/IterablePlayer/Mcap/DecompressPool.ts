// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { ChunkReadAhead } from "@lichtblick/mcap-core";
import { ByteBudget } from "@lichtblick/suite-base/players/ByteBudget";

export type DecompressRequest = {
  id: number;
  compression: string;
  buffer: Uint8Array;
  decompressedSize: bigint;
};
export type DecompressReply =
  | { ready: true }
  | { id: number; result: Uint8Array }
  | { id: number; error: string };

/** Worker-like: a Web Worker in the app, a fake in tests */
export type DecompressWorker = {
  postMessage(message: DecompressRequest, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<DecompressReply>) => void) | null;
  terminate(): void;
};

/** Decompression workers per source worker, shared by all its files */
const DECOMPRESS_WORKERS = 2;
/** Compressed plus decompressed bytes of chunks being loaded ahead, for all files together */
const READ_AHEAD_BYTES = 32 * 1024 * 1024;
/** Chunks a read keeps loading ahead of the one it is at */
const READ_AHEAD_CHUNKS = 8;

/**
 * Decompresses chunks on worker threads for reads that load chunks ahead (see ChunkReadAhead), so
 * a full pass over a compressed file isn't bound by one thread decompressing. Bytes in flight are
 * capped by a required ByteBudget; a chunk that doesn't fit isn't loaded ahead.
 */
export class DecompressPool implements ChunkReadAhead {
  public readonly chunks: number;
  readonly #workers: { worker: DecompressWorker; ready: boolean; busy: number }[];
  readonly #budget: ByteBudget;
  readonly #pending = new Map<
    number,
    { resolve: (result: Uint8Array) => void; reject: (error: Error) => void }
  >();
  #nextId = 0;
  #disposed = false;

  public constructor(args: {
    createWorker: () => DecompressWorker;
    workers: number;
    capacityBytes: number;
    chunks: number;
  }) {
    this.chunks = args.chunks;
    this.#budget = new ByteBudget(args.capacityBytes);
    this.#workers = Array.from({ length: args.workers }, () => {
      const entry = { worker: args.createWorker(), ready: false, busy: 0 };
      entry.worker.onmessage = ({ data }) => {
        if ("ready" in data) {
          entry.ready = true;
          return;
        }
        const pending = this.#pending.get(data.id);
        if (!pending) {
          return;
        }
        this.#pending.delete(data.id);
        entry.busy--;
        if ("result" in data) {
          pending.resolve(data.result);
        } else {
          pending.reject(new Error(data.error));
        }
      };
      return entry;
    });
  }

  public reserve(bytes: number): boolean {
    if (
      this.#disposed ||
      !this.#workers.some((entry) => entry.ready) ||
      !this.#budget.fits(bytes)
    ) {
      return false;
    }
    this.#budget.add(bytes);
    return true;
  }

  public release(bytes: number): void {
    // After dispose the budget was reset; loads that were still running give back nothing
    if (!this.#disposed) {
      this.#budget.release(bytes);
    }
  }

  public async decompress(
    compression: string,
    buffer: Uint8Array,
    decompressedSize: bigint,
  ): Promise<Uint8Array> {
    let best: number | undefined;
    for (let i = 0; i < this.#workers.length; i++) {
      const entry = this.#workers[i]!;
      if (entry.ready && (best == undefined || entry.busy < this.#workers[best]!.busy)) {
        best = i;
      }
    }
    if (this.#disposed || best == undefined) {
      throw new Error("No decompression worker available");
    }
    const entry = this.#workers[best]!;
    const id = this.#nextId++;
    entry.busy++;
    return await new Promise<Uint8Array>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      entry.worker.postMessage({ id, compression, buffer, decompressedSize }, [
        buffer.buffer as ArrayBuffer,
      ]);
    });
  }

  /** Stops the workers; decompressions still running fail, and nothing is loaded ahead anymore */
  public dispose(): void {
    this.#disposed = true;
    for (const { worker } of this.#workers) {
      worker.terminate();
    }
    for (const { reject } of this.#pending.values()) {
      reject(new Error("Decompression pool disposed"));
    }
    this.#pending.clear();
    this.#budget.reset();
  }
}

let shared: { pool: DecompressPool; leases: number } | undefined;

/**
 * The source worker's DecompressPool, started on the first lease and stopped when the last lease
 * is released, so every open file shares one set of workers and one memory cap. Undefined where
 * workers can't be started (tests, environments without nested workers).
 */
export function leaseDecompressPool(): { pool: DecompressPool; release: () => void } | undefined {
  if (typeof Worker === "undefined") {
    return undefined;
  }
  shared ??= {
    pool: new DecompressPool({
      createWorker: () => new Worker(new URL("./decompress.worker", import.meta.url)),
      workers: DECOMPRESS_WORKERS,
      capacityBytes: READ_AHEAD_BYTES,
      chunks: READ_AHEAD_CHUNKS,
    }),
    leases: 0,
  };
  const lease = shared;
  lease.leases++;
  let released = false;
  return {
    pool: lease.pool,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      if (--lease.leases === 0) {
        lease.pool.dispose();
        if (shared === lease) {
          shared = undefined;
        }
      }
    },
  };
}
