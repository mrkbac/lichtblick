// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import MockUserScriptPlayerWorker from "@lichtblick/suite-base/players/UserScriptPlayer/MockUserScriptPlayerWorker";
import delay from "@lichtblick/suite-base/util/delay";

import { RuntimeWorkerPool } from "./RuntimeWorkerPool";

function setup() {
  const workers: MockUserScriptPlayerWorker[] = [];
  const pool = new RuntimeWorkerPool(() => {
    const worker = new MockUserScriptPlayerWorker();
    workers.push(worker);
    return worker as unknown as SharedWorker;
  });
  return { pool, workers };
}

describe("RuntimeWorkerPool", () => {
  it("reuses released workers", () => {
    const { pool, workers } = setup();
    const a = pool.acquire(() => {});
    pool.acquire(() => {});
    pool.release(a);
    expect(pool.acquire(() => {})).toBe(a);
    expect(workers).toHaveLength(2);
    expect(pool.size()).toBe(2);
  });

  it("closes every worker, idle or in use, on dispose", async () => {
    const { pool, workers } = setup();
    const a = pool.acquire(() => {});
    pool.acquire(() => {});
    pool.acquire(() => {});
    pool.release(a);

    pool.dispose();
    await delay(0);

    expect(pool.size()).toBe(0);
    expect(workers).toHaveLength(3);
    expect(workers.filter((worker) => !worker.closed)).toEqual([]);
    expect(() => pool.acquire(() => {})).toThrow();
    // Releasing a worker after dispose doesn't bring it back.
    pool.release(a);
    expect(pool.size()).toBe(0);
  });
});
