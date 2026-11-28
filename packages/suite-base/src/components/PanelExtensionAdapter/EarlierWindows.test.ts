// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { pushAll } from "@lichtblick/den/collection";
import { MessageEvent } from "@lichtblick/suite";

import { EarlierWindows } from "./EarlierWindows";

const at = (...secs: number[]): MessageEvent[] =>
  secs.map((sec) => ({
    topic: "t",
    schemaName: "s",
    receiveTime: { sec, nsec: 0 },
    message: sec,
    sizeInBytes: 0,
  }));

describe("EarlierWindows", () => {
  it("appends later history and puts each earlier window in front once it ends", () => {
    let loaded: number[] = [];
    const windows = new EarlierWindows<number[]>(
      () => [],
      (earlier) => {
        loaded = [...earlier, ...loaded];
      },
    );
    // Around the playhead, an earlier window in two batches, a later one, then the earliest
    for (const batch of [at(5, 6), at(3), at(4), at(7, 8), at(1, 2)]) {
      const into = windows.place(batch) ?? loaded;
      pushAll(
        into,
        batch.map((event) => event.message as number),
      );
    }
    windows.flush();
    expect(loaded).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("starts a new earlier window when one follows another directly", () => {
    let loaded: number[] = [];
    const windows = new EarlierWindows<number[]>(
      () => [],
      (earlier) => {
        loaded = [...earlier, ...loaded];
      },
    );
    for (const batch of [at(5), at(3, 4), at(1, 2)]) {
      const into = windows.place(batch) ?? loaded;
      pushAll(
        into,
        batch.map((event) => event.message as number),
      );
    }
    windows.flush();
    expect(loaded).toEqual([1, 2, 3, 4, 5]);
  });

  it("leaves the earlier window out when the read is cancelled", async () => {
    let loaded: number[] = [];
    const windows = new EarlierWindows<number[]>(
      () => [],
      (earlier) => {
        loaded = [...earlier, ...loaded];
      },
    );
    let cancelled = false;
    async function* batches() {
      yield at(5, 6);
      yield at(3);
      // Cancelled mid-window: a newer read may own `loaded` now
      cancelled = true;
      loaded = [];
      yield at(4);
    }
    const done = await windows.read(
      batches(),
      () => cancelled,
      (batch, into) => {
        pushAll(
          into ?? loaded,
          batch.map((event) => event.message as number),
        );
      },
    );
    expect(done).toBe(false);
    expect(loaded).toEqual([]);
  });

  it("puts the last earlier window in front when the read ends", async () => {
    let loaded: number[] = [];
    const windows = new EarlierWindows<number[]>(
      () => [],
      (earlier) => {
        loaded = [...earlier, ...loaded];
      },
    );
    async function* batches() {
      yield* [at(5, 6), at(3), at(4)];
    }
    const done = await windows.read(
      batches(),
      () => false,
      (batch, into) => {
        pushAll(
          into ?? loaded,
          batch.map((event) => event.message as number),
        );
      },
    );
    expect(done).toBe(true);
    expect(loaded).toEqual([3, 4, 5, 6]);
  });
});
