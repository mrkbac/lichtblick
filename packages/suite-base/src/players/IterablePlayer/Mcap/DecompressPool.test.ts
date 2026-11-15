// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  DecompressPool,
  DecompressReply,
  DecompressRequest,
  DecompressWorker,
  leaseDecompressPool,
} from "./DecompressPool";

/** Answers each request when told to, with the input bytes reversed */
class FakeWorker implements DecompressWorker {
  public onmessage: ((event: MessageEvent<DecompressReply>) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public onmessageerror: ((event: MessageEvent) => void) | null = null;
  public requests: DecompressRequest[] = [];
  public terminated = false;

  public postMessage(message: DecompressRequest): void {
    this.requests.push(message);
  }
  public terminate(): void {
    this.terminated = true;
  }
  public ready(): void {
    this.#reply({ ready: true });
  }
  public answer(error?: string): void {
    const { id, buffer } = this.requests.shift()!;
    this.#reply(error != undefined ? { id, error } : { id, result: buffer.slice().reverse() });
  }
  public crash(): void {
    this.onerror?.(new ErrorEvent("error"));
  }
  #reply(data: DecompressReply): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

function makePool(capacityBytes = 100) {
  const workers: FakeWorker[] = [];
  const pool = new DecompressPool({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    workers: 2,
    capacityBytes,
    chunks: 4,
  });
  return { pool, workers };
}

describe("DecompressPool", () => {
  it("reserves nothing until a worker is ready", () => {
    // Given a pool whose workers are still loading
    const { pool, workers } = makePool();

    // When / Then: nothing fits until one says it's ready
    expect(pool.reserve(10)).toBe(false);
    workers[0]!.ready();
    expect(pool.reserve(10)).toBe(true);
  });

  it("caps reserved bytes and frees them on release", () => {
    // Given a ready pool with a 100 byte cap
    const { pool, workers } = makePool(100);
    workers[0]!.ready();

    // When 60 bytes are reserved, Then 60 more don't fit
    expect(pool.reserve(60)).toBe(true);
    expect(pool.reserve(60)).toBe(false);

    // When they are released, Then they fit again
    pool.release(60);
    expect(pool.reserve(60)).toBe(true);
  });

  it("requires a finite cap", () => {
    // Given / When / Then
    expect(() => makePool(Infinity)).toThrow();
  });

  it("spreads work over ready workers and resolves with their results", async () => {
    // Given two ready workers
    const { pool, workers } = makePool();
    workers[0]!.ready();
    workers[1]!.ready();

    // When two chunks are decompressed
    const first = pool.decompress("zstd", new Uint8Array([1, 2]), 2n);
    const second = pool.decompress("zstd", new Uint8Array([3, 4]), 2n);

    // Then each worker gets one, and each call resolves with its own result
    expect(workers.map((worker) => worker.requests.length)).toEqual([1, 1]);
    workers[1]!.answer();
    workers[0]!.answer();
    await expect(first).resolves.toEqual(new Uint8Array([2, 1]));
    await expect(second).resolves.toEqual(new Uint8Array([4, 3]));
  });

  it("rejects with the worker's error", async () => {
    // Given a ready worker
    const { pool, workers } = makePool();
    workers[0]!.ready();

    // When it fails to decompress a chunk
    const result = pool.decompress("zstd", new Uint8Array([1]), 1n);
    workers[0]!.answer("bad data");

    // Then the call rejects with its error
    await expect(result).rejects.toThrow("bad data");
  });

  it("fails the work of a crashed worker and gives it no more", async () => {
    // Given two ready workers, the first with a chunk in progress
    const { pool, workers } = makePool();
    workers[0]!.ready();
    workers[1]!.ready();
    const lost = pool.decompress("zstd", new Uint8Array([1]), 1n);
    expect(workers[0]!.requests).toHaveLength(1);

    // When that worker crashes without replying
    workers[0]!.crash();

    // Then its chunk fails, it is stopped, and later work goes to the other one
    await expect(lost).rejects.toThrow("worker failed");
    expect(workers[0]!.terminated).toBe(true);
    void pool.decompress("zstd", new Uint8Array([2]), 1n);
    void pool.decompress("zstd", new Uint8Array([3]), 1n);
    expect(workers[1]!.requests).toHaveLength(2);

    // When the other crashes too, Then nothing is reserved anymore
    workers[1]!.crash();
    expect(pool.reserve(1)).toBe(false);
  });

  it("stops its workers and fails pending work on dispose", async () => {
    // Given a ready pool with bytes reserved and a chunk in progress
    const { pool, workers } = makePool();
    workers[0]!.ready();
    expect(pool.reserve(10)).toBe(true);
    const result = pool.decompress("zstd", new Uint8Array([1]), 1n);

    // When it is disposed
    pool.dispose();

    // Then the chunk fails, the workers stop, nothing more is reserved, and late releases are fine
    await expect(result).rejects.toThrow("disposed");
    expect(workers.every((worker) => worker.terminated)).toBe(true);
    expect(pool.reserve(1)).toBe(false);
    expect(() => {
      pool.release(10);
    }).not.toThrow();
  });
});

describe("leaseDecompressPool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is undefined without Worker", () => {
    // Given an environment without workers
    vi.stubGlobal("Worker", undefined);

    // When / Then
    expect(leaseDecompressPool()).toBeUndefined();
  });

  it("is undefined, and stops the workers it started, when one can't be started", () => {
    // Given a Worker whose second construction throws
    const created: FakeWorker[] = [];
    vi.stubGlobal(
      "Worker",
      class extends FakeWorker {
        public constructor() {
          super();
          if (created.length === 1) {
            throw new Error("SecurityError");
          }
          created.push(this);
        }
      },
    );

    // When a lease is taken
    const lease = leaseDecompressPool();

    // Then there is none, and the first worker was stopped
    expect(lease).toBeUndefined();
    expect(created).toHaveLength(1);
    expect(created[0]!.terminated).toBe(true);
  });

  it("shares one pool and stops it when the last lease is released", () => {
    // Given two leases
    const created: FakeWorker[] = [];
    vi.stubGlobal(
      "Worker",
      class extends FakeWorker {
        public constructor() {
          super();
          created.push(this);
        }
      },
    );
    const a = leaseDecompressPool()!;
    const b = leaseDecompressPool()!;

    // Then they share one pool of two workers
    expect(b.pool).toBe(a.pool);
    expect(created).toHaveLength(2);

    // When the first is released (twice), Then the workers keep running
    a.release();
    a.release();
    expect(created.some((worker) => worker.terminated)).toBe(false);

    // When the last is released, Then they stop, and a new lease starts a new pool
    b.release();
    expect(created.every((worker) => worker.terminated)).toBe(true);
    const c = leaseDecompressPool()!;
    expect(c.pool).not.toBe(a.pool);
    c.release();
  });
});
