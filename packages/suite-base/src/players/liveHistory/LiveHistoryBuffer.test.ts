// SPDX-License-Identifier: MPL-2.0

import { fromSec } from "@foxglove/rostime";

import { MessageEvent } from "@lichtblick/suite-base/players/types";

import {
  CHECKPOINT_INTERVAL,
  HEAP_MIN_HISTORY_BYTES,
  heapLimitBytes,
  LiveHistoryBuffer,
  seedKeys,
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
  it("counts a transform message that names a frame twice once while it seeds", () => {
    const buffer = new LiveHistoryBuffer({ windowNs: 5n * SEC, maxBytes: 1e9 });
    for (let t = 1; t <= 100; t++) {
      buffer.add(tf(t, "a", "a"));
    }
    buffer.add(tf(200, "b")); // evicts every earlier one: the newest seeds frame a
    const one = tf(0, "b").sizeInBytes;
    expect(buffer.sizeBytes()).toBe(2 * one);
  });

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

  it("returns one topic's messages in [start, end]", () => {
    const buffer = new LiveHistoryBuffer({ windowNs: 100n * SEC, maxBytes: 1e9 });
    [1, 2, 3, 4, 5].forEach((t) => {
      buffer.add(msg("/a", t));
      buffer.add(msg("/b", t));
    });
    expect(times(buffer.messages("/a"))).toEqual([1, 2, 3, 4, 5]);
    expect(times(buffer.messages("/a", fromSec(2), fromSec(4)))).toEqual([2, 3, 4]);
    expect(times(buffer.messages("/b", undefined, fromSec(1)))).toEqual([1]);
    expect(buffer.messages("/c")).toEqual([]);
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
    expect(buffer.size()).toBe(4); // and the seed
    expect(buffer.capLimited()).toBe(true);
    expect(buffer.startTime(fromSec(10))).toEqual({ sec: 6, nsec: 1 }); // after the last evicted
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

  it("seeks without walking the history of other topics or frames", () => {
    const buffer = new LiveHistoryBuffer({ windowNs: 100_000n * SEC, maxBytes: 1e12 });
    let reads = 0;
    const counted = (event: MessageEvent): MessageEvent => {
      const { message } = event;
      return Object.defineProperty({ ...event }, "message", {
        get: () => {
          reads++;
          return message;
        },
      });
    };
    buffer.add(counted(tf(1, "static")));
    const last = 4 * CHECKPOINT_INTERVAL;
    for (let t = 2; t <= last; t++) {
      buffer.add(counted(t % 2 === 0 ? tf(t, "base") : msg("/a", t)));
    }
    // A subscribed topic with no messages and a transform topic used to walk the whole history on
    // every seek. While scrubbing, the second seek builds checkpoints; later ones read at most
    // one block.
    const topics = new Set(["/tf", "/a", "/empty"]);
    buffer.backfill(fromSec(last), topics);
    buffer.backfill(fromSec(last - 5000), topics);
    reads = 0;
    const result = buffer.backfill(fromSec(last - 1001), topics);
    expect(result.map((e) => [e.topic, e.receiveTime.sec])).toEqual([
      ["/tf", 1],
      ["/tf", last - 1002],
      ["/a", last - 1001],
    ]);
    expect(reads).toBeLessThanOrEqual(CHECKPOINT_INTERVAL);
  });

  it("backfills the same as a full scan, across checkpoints and evictions", () => {
    const windowSec = 3 * CHECKPOINT_INTERVAL;
    const buffer = new LiveHistoryBuffer({ windowNs: BigInt(windowSec) * SEC, maxBytes: 1e12 });
    const all: MessageEvent[] = [];
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const frames = ["a", "b", "c", "d"];
    const topics = new Set(["/tf", "/x", "/y", "/rare", "/empty"]);
    const expected = (at: number) => {
      const latest = new Map<string, MessageEvent>();
      for (const m of all) {
        if (m.receiveTime.sec <= at) {
          for (const key of seedKeys(m)) {
            latest.set(`${m.topic}/${key}`, m);
          }
        }
      }
      return times(
        [...new Set(latest.values())].sort((p, q) => p.receiveTime.sec - q.receiveTime.sec),
      );
    };
    const mismatches: number[] = [];
    for (let t = 1; t <= 10 * CHECKPOINT_INTERVAL; t++) {
      const r = random();
      const m =
        r < 0.4
          ? tf(t, ...frames.filter(() => random() < 0.5))
          : r < 0.7
            ? msg("/x", t)
            : r < 0.9999
              ? msg("/y", t)
              : msg("/rare", t);
      all.push(m);
      buffer.add(m);
      if (t % 5000 === 0) {
        for (let k = 0; k < 3; k++) {
          const at = t - Math.floor(random() * Math.min(t, windowSec));
          if (
            JSON.stringify(times(buffer.backfill(fromSec(at), topics))) !==
            JSON.stringify(expected(at))
          ) {
            mismatches.push(at);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("orders messages received at the same time by arrival, on every seek", () => {
    const buffer = new LiveHistoryBuffer({ windowNs: 100_000n * SEC, maxBytes: 1e12 });
    const first = tf(1, "a");
    const second = tf(1, "b");
    buffer.add(first);
    buffer.add(second);
    const last = 3 * CHECKPOINT_INTERVAL;
    for (let t = 2; t <= last; t++) {
      buffer.add(msg("/a", t));
    }
    const topics = new Set(["/tf"]);
    const seeks = [last, last - 1, last - 2].map((t) => buffer.backfill(fromSec(t), topics));
    for (const result of seeks) {
      expect(result).toEqual([first, second]);
    }
  });

  it("backfills correctly when every transform has a new frame", () => {
    const buffer = new LiveHistoryBuffer({
      windowNs: BigInt(2 * CHECKPOINT_INTERVAL) * SEC,
      maxBytes: 1e12,
    });
    const last = 4 * CHECKPOINT_INTERVAL;
    for (let t = 1; t <= last; t++) {
      buffer.add(tf(t, `frame${t}`));
    }
    const topics = new Set(["/tf"]);
    for (const at of [last, last - 10, last - 5000]) {
      const result = buffer.backfill(fromSec(at), topics);
      expect(result).toHaveLength(at); // one message per frame, from the window and the seeds
      expect(result.at(-1)!.receiveTime.sec).toBe(at);
    }
  });

  it("ignores malformed transform-like messages on other topics while scrubbing", () => {
    const buffer = new LiveHistoryBuffer({ windowNs: 100_000n * SEC, maxBytes: 1e12 });
    const last = 3 * CHECKPOINT_INTERVAL;
    for (let t = 1; t <= last; t++) {
      buffer.add(t % 2 === 0 ? msg("/json", t, { transforms: [null] }) : tf(t, "base"));
    }
    const topics = new Set(["/tf"]);
    for (const at of [last, last - 1, last - 2]) {
      expect(buffer.backfill(fromSec(at), topics).map((e) => e.topic)).toEqual(["/tf"]);
    }
  });

  it("takes newer frames than a whole message on a mixed topic while scrubbing", () => {
    const buffer = new LiveHistoryBuffer({ windowNs: 100_000n * SEC, maxBytes: 1e12 });
    const frame = (sec: number, child: string) =>
      msg("/mixed", sec, { transforms: [{ child_frame_id: child }] });
    buffer.add(frame(1, "a")); // hidden by the whole message after it
    buffer.add(msg("/mixed", 2));
    buffer.add(frame(3, "b"));
    const last = 3 * CHECKPOINT_INTERVAL;
    for (let t = 4; t <= last; t++) {
      buffer.add(msg("/a", t));
    }
    const topics = new Set(["/mixed"]);
    for (const at of [last, last - 1, last - 2]) {
      expect(times(buffer.backfill(fromSec(at), topics))).toEqual([2, 3]);
    }
  });

  it("doesn't build a checkpoint when the current block has everything", () => {
    const buffer = new LiveHistoryBuffer({ windowNs: 100_000n * SEC, maxBytes: 1e12 });
    const reads = { count: 0 };
    const counted = (event: MessageEvent): MessageEvent => {
      const { message } = event;
      return Object.defineProperty({ ...event }, "message", {
        get: () => {
          reads.count++;
          return message;
        },
      });
    };
    const last = 4 * CHECKPOINT_INTERVAL;
    for (let t = 1; t <= last; t++) {
      buffer.add(counted(msg("/a", t)));
    }
    const topics = new Set(["/a"]);
    buffer.backfill(fromSec(last), topics);
    // Including a seek that ends exactly at a block boundary.
    for (const at of [last - 1, 2 * CHECKPOINT_INTERVAL]) {
      reads.count = 0;
      expect(times(buffer.backfill(fromSec(at), topics))).toEqual([at]);
      expect(reads.count).toBeLessThan(10);
    }
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

describe("seedKeys", () => {
  it("detects transform messages by shape", () => {
    const keys = (message: unknown) => seedKeys({ message } as MessageEvent);
    expect(keys({ transforms: [{ child_frame_id: "a" }, { child_frame_id: "b" }] })).toEqual([
      "a",
      "b",
    ]);
    expect(keys({ parent_frame_id: "p", child_frame_id: "c" })).toEqual(["c"]);
    // Anything else is replaced as a whole
    expect(keys({ child_frame_id: "c", pose: {} })).toEqual([""]);
    expect(keys({ transforms: [{ x: 1 }] })).toEqual([""]);
    expect(keys(undefined)).toEqual([""]);
    expect(keys({ transforms: [null] })).toEqual([""]);
    expect(keys({ transforms: ["a"] })).toEqual([""]);
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
    expect(buffer.size()).toBe(2); // and the seed
    expect(buffer.capLimited()).toBe(true);
  });
});

describe("LiveHistoryBuffer seeds", () => {
  it("count toward the memory cap, once per seed message", () => {
    const buffer = new LiveHistoryBuffer({ windowNs: 2n * SEC, maxBytes: 1e9 });
    buffer.setRequestedTopics(new Set(["/tf", "/a"]));
    buffer.add(tf(1, "a", "b"));
    buffer.add(msg("/a", 1, {}, 100));
    buffer.add(msg("/a", 10)); // both earlier ones are now seeds
    expect(buffer.size()).toBe(1);
    expect(buffer.sizeBytes()).toBe(10 + 10 + 100);

    buffer.add(tf(11, "a")); // replaces frame a only: the first transform still seeds b
    buffer.add(msg("/a", 20)); // evicts both: the /a seed is replaced, frame b's stays
    expect(buffer.sizeBytes()).toBe(10 + 10 + 10 + 10);
  });

  it("of topics nobody requests go first when over the cap", () => {
    const buffer = new LiveHistoryBuffer({ windowNs: 2n * SEC, maxBytes: 1e9 });
    buffer.setRequestedTopics(new Set(["/a"]));
    buffer.add(msg("/map", 1, {}, 100));
    buffer.add(msg("/a", 2));
    buffer.add(msg("/a", 10));
    expect(buffer.sizeBytes()).toBe(100 + 10 + 10);

    buffer.setMaxBytes(30);
    expect(buffer.sizeBytes()).toBe(20);
    expect(buffer.size()).toBe(1); // nothing retained had to go
    expect(buffer.backfill(fromSec(10), new Set(["/a", "/map"])).map((m) => m.topic)).toEqual([
      "/a",
    ]);
  });
});

describe("LiveHistoryBuffer.messages", () => {
  it("reads one topic's messages through an index that follows additions and evictions", () => {
    const buffer = new LiveHistoryBuffer({ windowNs: 5n * SEC, maxBytes: 1e9 });
    for (let t = 1; t <= 4; t++) {
      buffer.add(msg(t % 2 === 0 ? "/even" : "/odd", t));
    }
    const secs = (messages: MessageEvent[]) => messages.map((m) => m.receiveTime.sec);
    expect(secs(buffer.messages("/even"))).toEqual([2, 4]);
    for (let t = 5; t <= 10; t++) {
      buffer.add(msg(t % 2 === 0 ? "/even" : "/odd", t)); // 1–4 fall out of the window
    }
    expect(secs(buffer.messages("/even"))).toEqual([6, 8, 10]);
    expect(secs(buffer.messages("/odd", fromSec(7), fromSec(9)))).toEqual([7, 9]);
    expect(buffer.messages("/none")).toEqual([]);
    buffer.clear();
    buffer.add(msg("/even", 20));
    expect(secs(buffer.messages("/even"))).toEqual([20]);
  });
});
