// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromSec } from "@foxglove/rostime";

import { MessageEvent } from "@lichtblick/suite-base/players/types";

import {
  HEAP_MIN_HISTORY_BYTES,
  heapLimitBytes,
  LiveHistoryBuffer,
  transformChildFrames,
} from "./LiveHistoryBuffer";

const SEC = 1_000_000_000n;

function msg(
  topic: string,
  sec: number,
  message: unknown = { value: sec },
  size = 10,
): MessageEvent {
  return {
    topic,
    receiveTime: fromSec(sec),
    message,
    sizeInBytes: size,
    schemaName: "S",
  };
}

function tf(sec: number, ...children: string[]): MessageEvent {
  return msg("/tf", sec, {
    transforms: children.map((child) => ({
      child_frame_id: child,
      header: { frame_id: "map" },
    })),
  });
}

const times = (events: MessageEvent[]) => events.map((e) => e.receiveTime.sec);

describe("LiveHistoryBuffer", () => {
  it("expires messages older than the window as time moves forward", () => {
    const buffer = new LiveHistoryBuffer({
      windowNs: 10n * SEC,
      maxBytes: 1e9,
    });
    for (let t = 1; t <= 30; t++) {
      buffer.add(msg("/a", t));
    }
    expect(buffer.size()).toBe(11); // 20..30
    expect(buffer.startTime(fromSec(30))).toEqual(fromSec(20));
    expect(times(buffer.range(fromSec(0), fromSec(30)))).toEqual([
      20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    ]);

    buffer.trim(fromSec(35)); // no new messages, window keeps moving
    expect(buffer.size()).toBe(6);
    expect(buffer.startTime(fromSec(35))).toEqual(fromSec(25));
  });

  it("starts the range at the first message until the window is full", () => {
    const buffer = new LiveHistoryBuffer({
      windowNs: 30n * SEC,
      maxBytes: 1e9,
    });
    buffer.add(msg("/a", 100));
    buffer.add(msg("/a", 105));
    expect(buffer.startTime(fromSec(105))).toEqual(fromSec(100));
  });

  it("returns messages in (after, upTo]", () => {
    const buffer = new LiveHistoryBuffer({
      windowNs: 100n * SEC,
      maxBytes: 1e9,
    });
    [1, 2, 3, 4, 5].forEach((t) => {
      buffer.add(msg("/a", t));
    });
    expect(times(buffer.range(fromSec(2), fromSec(4)))).toEqual([3, 4]);
    expect(buffer.range(fromSec(5), fromSec(9))).toEqual([]);
  });

  it("returns messages after a given one, including later ones at the same time", () => {
    const buffer = new LiveHistoryBuffer({
      windowNs: 100n * SEC,
      maxBytes: 1e9,
    });
    const first = msg("/a", 2, { value: "first" });
    const second = msg("/b", 2, { value: "second" });
    [msg("/a", 1), first, second, msg("/a", 3), msg("/a", 4)].forEach((m) => {
      buffer.add(m);
    });
    expect(buffer.rangeAfter(first, fromSec(3))).toEqual([second, msg("/a", 3)]);
    expect(buffer.rangeAfter(second, fromSec(3))).toEqual([msg("/a", 3)]);
  });

  it("drops the oldest messages beyond the memory cap and reports it", () => {
    const buffer = new LiveHistoryBuffer({
      windowNs: 100n * SEC,
      maxBytes: 50,
    });
    for (let t = 1; t <= 10; t++) {
      buffer.add(msg("/a", t));
    }
    expect(buffer.sizeBytes()).toBeLessThanOrEqual(50);
    expect(buffer.size()).toBe(5);
    expect(buffer.capLimited()).toBe(true);
    expect(buffer.startTime(fromSec(10))).toEqual({ sec: 5, nsec: 1 }); // after the last evicted
  });

  it("clears the cap warning once the window, not memory, limits the history", () => {
    const buffer = new LiveHistoryBuffer({
      windowNs: 100n * SEC,
      maxBytes: 50,
    });
    for (let t = 1; t <= 10; t++) {
      buffer.add(msg("/a", t));
    }
    expect(buffer.capLimited()).toBe(true);
    buffer.setWindow(2n * SEC);
    buffer.trim(fromSec(10));
    expect(buffer.capLimited()).toBe(false);
  });

  it("grows the range gradually after the window is enlarged", () => {
    const buffer = new LiveHistoryBuffer({ windowNs: 10n * SEC, maxBytes: 1e9 });
    for (let t = 1; t <= 100; t++) {
      buffer.add(msg("/a", t));
    }
    buffer.setWindow(60n * SEC);
    expect(buffer.startTime(fromSec(100))).toEqual(fromSec(90)); // only 10 s are held
    buffer.add(msg("/a", 120));
    expect(buffer.startTime(fromSec(120))).toEqual(fromSec(90));
    buffer.trim(fromSec(200));
    expect(buffer.startTime(fromSec(200))).toEqual(fromSec(140));
  });

  it("keeps the last expired message per topic as a seed for backfill", () => {
    const buffer = new LiveHistoryBuffer({
      windowNs: 10n * SEC,
      maxBytes: 1e9,
    });
    buffer.add(msg("/latched", 1));
    buffer.add(msg("/latched", 2));
    for (let t = 3; t <= 30; t++) {
      buffer.add(msg("/a", t));
    }
    const result = buffer.backfill(fromSec(25), new Set(["/latched", "/a"]));
    expect(result.map((e) => [e.topic, e.receiveTime.sec])).toEqual([
      ["/latched", 2],
      ["/a", 25],
    ]);
  });

  it("snapshots seeds before the retained messages", () => {
    const buffer = new LiveHistoryBuffer({
      windowNs: 10n * SEC,
      maxBytes: 1e9,
    });
    buffer.add(msg("/latched", 1));
    for (let t = 15; t <= 20; t++) {
      buffer.add(msg("/a", t));
    }
    expect(buffer.snapshot().map((e) => [e.topic, e.receiveTime.sec])).toEqual([
      ["/latched", 1],
      ...[15, 16, 17, 18, 19, 20].map((t) => ["/a", t]),
    ]);
  });

  it("only backfills requested topics", () => {
    const buffer = new LiveHistoryBuffer({
      windowNs: 10n * SEC,
      maxBytes: 1e9,
    });
    buffer.add(msg("/a", 1));
    buffer.add(msg("/b", 2));
    expect(buffer.backfill(fromSec(2), new Set(["/b"])).map((e) => e.topic)).toEqual(["/b"]);
  });

  it("backfills the latest transform per child frame, from window and seeds", () => {
    const buffer = new LiveHistoryBuffer({
      windowNs: 10n * SEC,
      maxBytes: 1e9,
    });
    buffer.add(tf(1, "static_child")); // expires: seed
    buffer.add(tf(2, "base", "arm")); // expires: seed, base later replaced
    buffer.add(tf(15, "base"));
    buffer.add(tf(16, "base"));
    buffer.add(tf(20, "base")); // after the seek time
    const result = buffer.backfill(fromSec(17), new Set(["/tf"]));
    expect(times(result)).toEqual([1, 2, 16]);
  });

  it("clears everything, including seeds, e.g. on a clock reset", () => {
    const buffer = new LiveHistoryBuffer({ windowNs: 1n * SEC, maxBytes: 1e9 });
    buffer.add(msg("/a", 1));
    buffer.add(msg("/a", 5));
    buffer.clear();
    expect(buffer.size()).toBe(0);
    expect(buffer.sizeBytes()).toBe(0);
    expect(buffer.backfill(fromSec(5), new Set(["/a"]))).toEqual([]);
    buffer.add(msg("/a", 0));
    expect(buffer.startTime(fromSec(0))).toEqual(fromSec(0));
  });
});

describe("transformChildFrames", () => {
  it("detects transform messages by shape", () => {
    expect(
      transformChildFrames({
        transforms: [{ child_frame_id: "a" }, { child_frame_id: "b" }],
      }),
    ).toEqual(["a", "b"]);
    expect(transformChildFrames({ parent_frame_id: "p", child_frame_id: "c" })).toEqual(["c"]);
    expect(transformChildFrames({ child_frame_id: "c", pose: {} })).toBeUndefined();
    expect(transformChildFrames({ transforms: [{ x: 1 }] })).toBeUndefined();
    expect(transformChildFrames(undefined)).toBeUndefined();
  });
});

describe("heapLimitBytes", () => {
  const MIB = 1024 * 1024;
  const heap = (fraction: number) => ({ usedJSHeapSize: fraction * 1000, jsHeapSizeLimit: 1000 });

  it("imposes no limit without heap info or with room to spare", () => {
    expect(heapLimitBytes(undefined, 100 * MIB, undefined)).toBeUndefined();
    expect(heapLimitBytes(heap(0.5), 100 * MIB, undefined)).toBeUndefined();
  });

  it("shrinks the history by a quarter while the heap is nearly full", () => {
    const first = heapLimitBytes(heap(0.9), 100 * MIB, undefined);
    expect(first).toBe(75 * MIB);
    expect(heapLimitBytes(heap(0.9), 75 * MIB, first)).toBe(Math.floor(75 * MIB * 0.75));
  });

  it("never shrinks below the floor", () => {
    expect(heapLimitBytes(heap(0.95), 1 * MIB, undefined)).toBe(HEAP_MIN_HISTORY_BYTES);
  });

  it("keeps the limit between the water marks and lifts it once the heap recovers", () => {
    expect(heapLimitBytes(heap(0.8), 75 * MIB, 75 * MIB)).toBe(75 * MIB);
    expect(heapLimitBytes(heap(0.6), 75 * MIB, 75 * MIB)).toBeUndefined();
  });
});

describe("LiveHistoryBuffer.setMaxBytes", () => {
  it("applies a lower memory limit right away", () => {
    const buffer = new LiveHistoryBuffer({ windowNs: 100n * SEC, maxBytes: 1e9 });
    for (let t = 1; t <= 10; t++) {
      buffer.add(msg("/a", t));
    }
    buffer.setMaxBytes(30); // no trim with a clock needed
    expect(buffer.size()).toBe(3);
    expect(buffer.capLimited()).toBe(true);
  });
});
