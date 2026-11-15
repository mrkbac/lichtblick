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
    const { pool, workers } = makePool();
    expect(pool.reserve(10)).toBe(false);
    workers[0]!.ready();
    expect(pool.reserve(10)).toBe(true);
  });

  it("caps reserved bytes and frees them on release", () => {
    const { pool, workers } = makePool(100);
    workers[0]!.ready();
    expect(pool.reserve(60)).toBe(true);
    expect(pool.reserve(60)).toBe(false);
    pool.release(60);
    expect(pool.reserve(60)).toBe(true);
  });

  it("requires a finite cap", () => {
    expect(() => makePool(Infinity)).toThrow();
  });

  it("spreads work over ready workers and resolves with their results", async () => {
    const { pool, workers } = makePool();
    workers[0]!.ready();
    workers[1]!.ready();
    const first = pool.decompress("zstd", new Uint8Array([1, 2]), 2n);
    const second = pool.decompress("zstd", new Uint8Array([3, 4]), 2n);
    expect(workers.map((worker) => worker.requests.length)).toEqual([1, 1]);
    workers[1]!.answer();
    workers[0]!.answer();
    await expect(first).resolves.toEqual(new Uint8Array([2, 1]));
    await expect(second).resolves.toEqual(new Uint8Array([4, 3]));
  });

  it("rejects with the worker's error", async () => {
    const { pool, workers } = makePool();
    workers[0]!.ready();
    const result = pool.decompress("zstd", new Uint8Array([1]), 1n);
    workers[0]!.answer("bad data");
    await expect(result).rejects.toThrow("bad data");
  });

  it("stops its workers and fails pending work on dispose", async () => {
    const { pool, workers } = makePool();
    workers[0]!.ready();
    expect(pool.reserve(10)).toBe(true);
    const result = pool.decompress("zstd", new Uint8Array([1]), 1n);
    pool.dispose();
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
    vi.stubGlobal("Worker", undefined);
    expect(leaseDecompressPool()).toBeUndefined();
  });

  it("shares one pool and stops it when the last lease is released", () => {
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
    expect(b.pool).toBe(a.pool);
    expect(created).toHaveLength(2);

    a.release();
    a.release(); // a second release of the same lease is ignored
    expect(created.some((worker) => worker.terminated)).toBe(false);
    b.release();
    expect(created.every((worker) => worker.terminated)).toBe(true);

    const c = leaseDecompressPool()!;
    expect(c.pool).not.toBe(a.pool);
    c.release();
  });
});
