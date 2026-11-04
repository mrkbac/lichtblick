// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fromNanoSec } from "@lichtblick/rostime";
import { IteratorResult } from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";

import {
  BUCKET_COUNT,
  aggregateBuckets,
  bucketTime,
  createInspectionState,
  finishInspection,
  inspectTopic,
  updateInspection,
} from "./inspection";

async function* messages(times: bigint[]): AsyncIterableIterator<IteratorResult> {
  for (const time of times) {
    yield {
      type: "message-event",
      msgEvent: {
        topic: "/test",
        receiveTime: fromNanoSec(time),
        message: {},
        sizeInBytes: 10,
        schemaName: "test",
      },
    };
  }
}

const start = fromNanoSec(1_700_000_000_000_000_000n);
const end = fromNanoSec(1_700_000_010_000_000_000n);
const base = 1_700_000_000_000_000_000n;

it("counts inclusive boundaries and aggregates intervals across iterator batches without losing nanoseconds", async () => {
  const result = await inspectTopic(
    messages([base, base + 1n, base + 10_000_000_000n]),
    start,
    end,
    new AbortController().signal,
    jest.fn(),
  );
  expect(result.count).toBe(3);
  expect(result.bytes).toBe(30);
  expect(result.buckets[0]).toBe(2);
  expect(result.buckets[BUCKET_COUNT - 1]).toBe(1);
  expect(result.buckets.reduce((sum, count) => sum + count, 0)).toBe(3);
  expect(result.largestInterval?.nanoseconds).toBe(9_999_999_999n);
  expect(result.first).toEqual(start);
  expect(result.last).toEqual(end);
  expect(bucketTime(start, end, BUCKET_COUNT)).toEqual(end);
});

it("handles empty, single-time, and duplicate-time recordings without inventing a rate or gap", async () => {
  const empty = await inspectTopic(
    messages([]),
    start,
    end,
    new AbortController().signal,
    jest.fn(),
  );
  expect(empty.first).toBeUndefined();
  expect(empty.largestInterval).toBeUndefined();
  const sameTime = await inspectTopic(
    messages([base, base]),
    start,
    start,
    new AbortController().signal,
    jest.fn(),
  );
  expect(sameTime.count).toBe(2);
  expect(sameTime.buckets[0]).toBe(2);
  expect(sameTime.largestInterval?.nanoseconds).toBe(0n);
});

it("excludes messages outside the requested interval", async () => {
  const result = await inspectTopic(
    messages([base - 1n, base, base + 10_000_000_001n]),
    start,
    end,
    new AbortController().signal,
    jest.fn(),
  );
  expect(result.count).toBe(1);
});

it("rejects reversals and source alerts instead of presenting incomplete statistics as complete", async () => {
  await expect(
    inspectTopic(messages([base + 1n, base]), start, end, new AbortController().signal, jest.fn()),
  ).rejects.toThrow("out of time order");
  async function* alerts(): AsyncIterableIterator<IteratorResult> {
    yield {
      type: "alert",
      connectionId: 0,
      alert: { severity: "error", message: "Cannot decode topic" },
    };
  }
  await expect(
    inspectTopic(alerts(), start, end, new AbortController().signal, jest.fn()),
  ).rejects.toThrow("Cannot decode topic");
});

it("cancels and closes the iterator", async () => {
  const controller = new AbortController();
  const closed = jest.fn();
  async function* cancellable(): AsyncIterableIterator<IteratorResult> {
    try {
      controller.abort();
      yield* messages([base]);
    } finally {
      closed();
    }
  }
  await expect(
    inspectTopic(cancellable(), start, end, controller.signal, jest.fn()),
  ).rejects.toThrow();
  expect(closed).toHaveBeenCalledTimes(1);
});

it("aggregates measured topic buckets without modifying the topic results", async () => {
  const first = await inspectTopic(
    messages([base]),
    start,
    end,
    new AbortController().signal,
    jest.fn(),
  );
  const second = await inspectTopic(
    messages([base, base + 10_000_000_000n]),
    start,
    end,
    new AbortController().signal,
    jest.fn(),
  );
  const combined = aggregateBuckets([first, second]);
  expect(combined[0]).toBe(2);
  expect(combined[BUCKET_COUNT - 1]).toBe(1);
  expect(first.buckets[0]).toBe(1);
});

it("uses exact serialized sizes when the source provides them", async () => {
  async function* exact(): AsyncIterableIterator<IteratorResult> {
    for await (const item of messages([base])) {
      if (item.type === "message-event") {
        yield { ...item, msgEvent: { ...item.msgEvent, serializedSizeInBytes: 3 } };
      }
    }
  }
  const result = await inspectTopic(exact(), start, end, new AbortController().signal, jest.fn());
  expect(result.bytes).toBe(3);
  expect(result.estimatedBytes).toBe(false);
});

it("measures interleaved topics in one pass with independent timing statistics", async () => {
  const { inspectTopics } = await import("./inspection");
  async function* interleaved(): AsyncIterableIterator<IteratorResult> {
    for (const [topic, ns] of [
      ["/a", 0n],
      ["/b", 0n],
      ["/a", 1_000_000_000n],
      ["/b", 2_000_000_000n],
      ["/a", 3_000_000_000n],
      ["/a", 3_000_000_000n],
    ] as const) {
      for await (const item of messages([base + ns])) {
        if (item.type === "message-event") {
          yield { ...item, msgEvent: { ...item.msgEvent, topic, serializedSizeInBytes: 3 } };
        }
      }
    }
  }
  const result = await inspectTopics(
    interleaved(),
    ["/a", "/b", "/empty"],
    start,
    end,
    new AbortController().signal,
    jest.fn(),
  );
  expect(result.get("/a")?.timing).toEqual({
    minimumHz: 0.5,
    maximumHz: 1,
    medianHz: 0.75,
    medianEstimated: false,
    jitterNs: Math.sqrt(2 / 3) * 1e9,
    duplicateTimestamps: 1,
  });
  expect(result.get("/a")?.bytes).toBe(12);
  expect(result.get("/b")?.timing?.medianHz).toBe(0.5);
  expect(result.get("/empty")?.count).toBe(0);
  expect(result.get("/empty")?.timing).toBeUndefined();
});

it("bounds median samples while keeping exact jitter and extrema for long recordings", async () => {
  const times = Array.from({ length: 10_001 }, (_, i) => base + BigInt(i) * 1_000_000n);
  const result = await inspectTopic(
    messages(times),
    start,
    end,
    new AbortController().signal,
    jest.fn(),
  );
  expect(result.timing).toEqual({
    minimumHz: 1000,
    maximumHz: 1000,
    medianHz: 1000,
    medianEstimated: true,
    jitterNs: 0,
    duplicateTimestamps: 0,
  });
});

it("updates incrementally, counts reversals without failing, and keeps the state usable after a snapshot", () => {
  const state = createInspectionState();
  for (const offset of [0n, 100_000_000n, 200_000_000n, 150_000_000n, 300_000_000n]) {
    updateInspection(state, { receiveTime: fromNanoSec(base + offset), sizeInBytes: 4 });
  }
  const snapshot = finishInspection(state);
  expect(state.reversals).toBe(1);
  expect(snapshot).toMatchObject({ count: 5, bytes: 20, estimatedBytes: true });
  expect(snapshot.largestInterval?.nanoseconds).toBe(150_000_000n);
  expect(snapshot.timing?.medianHz).toBeCloseTo(10);

  updateInspection(state, {
    receiveTime: fromNanoSec(base + 400_000_000n),
    sizeInBytes: 9,
    serializedSizeInBytes: 4,
  });
  expect(finishInspection(state)).toMatchObject({ count: 6, bytes: 24 });
  expect(snapshot.count).toBe(5);
});
