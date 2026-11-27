// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare } from "@foxglove/rostime";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { MessageEvent } from "@lichtblick/suite";
import { TopicSelection } from "@lichtblick/suite-base/players/types";

import { IteratorResult } from "./IIterableSource";
import { playheadWindows, SharedRangeReads } from "./SharedRangeReads";

function message(topic: string, sec: number): MessageEvent {
  return {
    topic,
    receiveTime: { sec, nsec: 0 },
    message: undefined,
    sizeInBytes: 1,
    schemaName: "s",
  };
}

const messages = [0, 1, 2, 3].flatMap((sec) => ["a", "b", "c"].map((topic) => message(topic, sec)));

function setup() {
  const reads: TopicSelection[] = [];
  const shared = new SharedRangeReads(async function* (topics) {
    reads.push(topics);
    for (const msgEvent of messages) {
      if (topics.has(msgEvent.topic)) {
        yield { type: "message-event", msgEvent };
      }
    }
  });
  return { shared, reads };
}

async function collect(iterator: AsyncIterableIterator<Readonly<IteratorResult>>) {
  const topics: string[] = [];
  for await (const result of iterator) {
    if (result.type === "message-event") {
      topics.push(`${result.msgEvent.topic}${result.msgEvent.receiveTime.sec}`);
    }
  }
  return topics;
}

describe("SharedRangeReads", () => {
  it("reads topics requested together over the same range in one pass", async () => {
    const { shared, reads } = setup();

    const [a, b, alsoA] = await Promise.all([
      collect(shared.read("a", {})),
      collect(shared.read("b", {})),
      collect(shared.read("a", {})),
    ]);

    expect(reads.map((topics) => [...topics.keys()])).toEqual([["a", "b"]]);
    expect(a).toEqual(["a0", "a1", "a2", "a3"]);
    expect(alsoA).toEqual(a);
    expect(b).toEqual(["b0", "b1", "b2", "b3"]);
  });

  it("starts reads of part of the recording right away, on their own", async () => {
    const { shared, reads } = setup();

    const whole = collect(shared.read("a", {}));
    const partial = shared.read("b", { start: { sec: 1, nsec: 0 } });
    // Read before the whole-history read has gathered its readers
    expect((await partial.next()).done).toBe(false);
    expect(reads.map((topics) => [...topics.keys()])).toEqual([["b"]]);

    await Promise.all([whole, collect(partial)]);
    expect(reads.map((topics) => [...topics.keys()])).toEqual([["b"], ["a"]]);
  });

  it("keeps reading for the others when one reader stops", async () => {
    const { shared } = setup();
    const stopping = shared.read("a", {});
    const b = shared.read("b", {});

    expect((await stopping.next()).done).toBe(false);
    await stopping.return?.();

    expect(await collect(b)).toEqual(["b0", "b1", "b2", "b3"]);
    expect((await stopping.next()).done).toBe(true);
  });

  it("aborts the source only once the last reader cancels", async () => {
    const opened = Promise.withResolvers<AbortSignal>();
    const closed = Promise.withResolvers<void>();
    const shared = new SharedRangeReads(async function* (_topics, _range, signal) {
      const stop = Promise.withResolvers<void>();
      signal.addEventListener(
        "abort",
        () => {
          stop.resolve();
        },
        { once: true },
      );
      opened.resolve(signal);
      try {
        await stop.promise;
        yield* [];
      } finally {
        closed.resolve();
      }
    });
    const a = shared.read("a", {});
    const b = shared.read("b", {});
    const pulls = [a.next(), b.next()];
    const signal = await opened.promise;

    await a.return?.();
    expect(signal.aborted).toBe(false);
    await b.return?.();
    expect(signal.aborted).toBe(true);
    await closed.promise;
    await expect(Promise.all(pulls)).resolves.toEqual([
      { done: true, value: undefined },
      { done: true, value: undefined },
    ]);
  });

  it("resolves overlapping pulls in order", async () => {
    const { shared } = setup();
    const reader = shared.read("a", {});
    const [first, second] = await Promise.all([reader.next(), reader.next()]);
    expect(first.value).toMatchObject({ msgEvent: { receiveTime: { sec: 0 } } });
    expect(second.value).toMatchObject({ msgEvent: { receiveTime: { sec: 1 } } });
    await reader.return?.();
  });

  it("reports an error thrown while opening the iterator", async () => {
    const shared = new SharedRangeReads(() => {
      throw new Error("open failed");
    });
    await expect(collect(shared.read("a", {}))).rejects.toThrow("open failed");
  });

  it("hands a read error to every reader", async () => {
    const shared = new SharedRangeReads(async function* () {
      yield* [];
      throw new Error("read failed");
    });

    await expect(collect(shared.read("a", {}))).rejects.toThrow("read failed");
  });

  it("doesn't stall a consumer that merges its readers by time", async () => {
    // 5000 dense messages (more than a reader queues) before the sparse topic's first one, which
    // shares its receive time with two dense ones
    const recording = [
      ...Array.from({ length: 5000 }, (_, i) => message("dense", i)),
      message("dense", 5000),
      message("sparse", 5000),
      message("dense", 5000),
      message("sparse", 5001),
    ];
    const reads: string[][] = [];
    const shared = new SharedRangeReads(async function* (topics, range) {
      reads.push([...topics.keys()]);
      for (const msgEvent of recording) {
        if (
          topics.has(msgEvent.topic) &&
          (!range.start || msgEvent.receiveTime.sec >= range.start.sec)
        ) {
          yield { type: "message-event", msgEvent };
        }
      }
    });
    const dense = shared.read("dense", {});
    const sparse = shared.read("sparse", {});

    // Like a merge by time: the first message of every input before any further one
    const firstDense = dense.next();
    const firstSparse = await sparse.next();
    expect((await firstDense).done).toBe(false);

    expect(firstSparse.value).toMatchObject({ msgEvent: { topic: "sparse" } });
    expect(await collect(sparse)).toEqual(["sparse5001"]);
    expect(await collect(dense)).toHaveLength(5001);
    expect(reads).toEqual([["dense", "sparse"], ["sparse"]]);
  });

  it("goes on without an iterator that is never read", async () => {
    // More messages for the unread topic than a reader queues
    const recording = Array.from({ length: 5000 }, (_, i) => [
      message("a", i),
      message("b", i),
    ]).flat();
    const shared = new SharedRangeReads(async function* (topics) {
      for (const msgEvent of recording) {
        if (topics.has(msgEvent.topic)) {
          yield { type: "message-event", msgEvent };
        }
      }
    });
    const neverRead = shared.read("a", {});
    const read = shared.read("b", {});

    expect(await collect(read)).toHaveLength(5000);
    await neverRead.return?.();
  });

  it("fails a waiting reader whose own read can't be opened", async () => {
    const recording = [
      ...Array.from({ length: 5000 }, (_, i) => message("dense", i)),
      message("sparse", 5000),
    ];
    const shared = new SharedRangeReads((topics) => {
      if (!topics.has("dense")) {
        throw new Error("can't open");
      }
      return (async function* () {
        for (const msgEvent of recording) {
          if (topics.has(msgEvent.topic)) {
            yield { type: "message-event" as const, msgEvent };
          }
        }
      })();
    });
    const dense = shared.read("dense", {});
    const sparse = shared.read("sparse", {});

    void dense.next();
    await expect(sparse.next()).rejects.toThrow("can't open");
    await dense.return?.();
  });

  it("ends a waiting pull right away when a reader on its own read is closed", async () => {
    const recording = Array.from({ length: 5000 }, (_, i) => message("dense", i));
    // Its own read never delivers, like a remote read that hangs
    const hanging: AsyncIterableIterator<Readonly<IteratorResult>> = {
      next: async () => await new Promise<never>(() => {}),
      return: async () => await new Promise<never>(() => {}),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    const shared = new SharedRangeReads((topics) =>
      topics.has("dense")
        ? (async function* () {
            for (const msgEvent of recording) {
              yield { type: "message-event" as const, msgEvent };
            }
          })()
        : hanging,
    );
    const dense = shared.read("dense", {});
    const sparse = shared.read("sparse", {});
    void dense.next();
    const pending = sparse.next();
    // Let the shared read fill up and hand "sparse" its own read
    await new Promise((resolve) => setTimeout(resolve, 50));

    await sparse.return?.();
    expect(await pending).toEqual({ done: true, value: undefined });
    await dense.return?.();
  });

  it("answers overlapping pulls in order", async () => {
    const { shared } = setup();
    const reader = shared.read("a", {});

    const results = await Promise.all([reader.next(), reader.next(), reader.next()]);
    expect(
      results.map(
        (result) => (result.value as { msgEvent: MessageEvent }).msgEvent.receiveTime.sec,
      ),
    ).toEqual([0, 1, 2]);
  });

  it("keeps no delivered message alive on a reader with its own read", async () => {
    setFlagsFromString("--expose_gc");
    const gc = runInNewContext("gc") as () => void;
    const recording = Array.from({ length: 5000 }, (_, i) => message("dense", i));
    let delivered: WeakRef<object> | undefined;
    const tracked = () => {
      const payload = { data: new Uint8Array(1024) };
      delivered = new WeakRef(payload);
      return payload;
    };
    const shared = new SharedRangeReads((topics) =>
      topics.has("dense")
        ? (async function* () {
            for (const msgEvent of recording) {
              yield { type: "message-event" as const, msgEvent };
            }
          })()
        : (async function* () {
            yield {
              type: "message-event" as const,
              msgEvent: { ...message("sparse", 6000), message: tracked() },
            };
            await new Promise<never>(() => {});
          })(),
    );
    const dense = shared.read("dense", {});
    const sparse = shared.read("sparse", {});
    void dense.next();
    // Gets its message from its own read: the shared one waits for "dense" to be read
    expect((await sparse.next()).done).toBe(false);
    const stillPulling = sparse.next();

    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();
    expect(delivered?.deref()).toBeUndefined();

    await sparse.return?.();
    await stillPulling;
    await dense.return?.();
  });

  it("lets a read that starts during a pass join it, reading only what it missed on its own", async () => {
    const reads: { topics: string[]; start?: number; end?: number }[] = [];
    let release!: () => void;
    let gate = new Promise<void>((resolve) => (release = resolve));
    const shared = new SharedRangeReads(async function* (topics, range) {
      reads.push({ topics: [...topics.keys()], start: range.start?.sec, end: range.end?.sec });
      for (const msgEvent of messages) {
        if (
          !topics.has(msgEvent.topic) ||
          (range.start && msgEvent.receiveTime.sec < range.start.sec) ||
          (range.end && msgEvent.receiveTime.sec > range.end.sec)
        ) {
          continue;
        }
        // The first pass stops after its second second until released
        if (topics.size === 1 && topics.has("a") && !range.end && msgEvent.receiveTime.sec === 2) {
          await gate;
        }
        yield { type: "message-event", msgEvent };
      }
    });

    const a = shared.read("a", {});
    const aSeen: string[] = [];
    for (let i = 0; i < 2; i++) {
      const next = await a.next();
      if (next.done !== true && next.value.type === "message-event") {
        aSeen.push(`a${next.value.msgEvent.receiveTime.sec}`);
      }
    }
    // The pass is at second 1 and waits: a second read starts now
    const b = collect(shared.read("b", {}));
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    gate = Promise.resolve();
    const aRest = await collect(a);

    expect([...aSeen, ...aRest]).toEqual(["a0", "a1", "a2", "a3"]);
    expect(await b).toEqual(["b0", "b1", "b2", "b3"]);
    // One pass for "a", a catch-up of "b" up to where the pass was, and the pass going on with both
    expect(reads).toEqual([
      { topics: ["a"], start: undefined, end: undefined },
      { topics: ["b"], start: undefined, end: 1 },
      { topics: ["a", "b"], start: 1, end: undefined },
    ]);
  });

  describe("late joiners", () => {
    /** A source over `recording` (inclusive ranges); `onEnd` runs when a read of `topics` ends */
    function recordingSource(
      recording: readonly Readonly<IteratorResult>[],
      gate?: { topics: string; sec: number; open: Promise<void> },
      onEnd?: (topics: string) => void,
    ) {
      return new SharedRangeReads(async function* (topics, range) {
        const key = [...topics.keys()].join();
        try {
          for (const result of recording) {
            if (result.type === "message-event") {
              const { topic, receiveTime } = result.msgEvent;
              if (
                !topics.has(topic) ||
                (range.start && compare(receiveTime, range.start) < 0) ||
                (range.end && compare(receiveTime, range.end) > 0)
              ) {
                continue;
              }
              if (gate && key === gate.topics && receiveTime.sec === gate.sec) {
                await gate.open;
              }
            }
            yield result;
          }
        } finally {
          onEnd?.(key);
        }
      });
    }
    const events = (topic: string, secs: number[]): IteratorResult[] =>
      secs.map((sec) => ({ type: "message-event", msgEvent: message(topic, sec) }));
    const range = (n: number) => Array.from({ length: n }, (_, i) => i);

    it("doesn't deliver its catch-up twice when it falls behind and reads on its own", async () => {
      // "a" stops pulling, so the pass waits for room with its queue full, past the 4096th message
      const recording = range(5000).flatMap((sec) => [
        ...events("a", [sec]),
        ...events("b", [sec]),
      ]);
      const shared = recordingSource(recording);
      const a = shared.read("a", {});
      expect((await a.next()).done).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Joins late, catches up to where the pass waits, then waits itself and reads on its own
      const b = await collect(shared.read("b", {}));
      expect(b).toEqual(range(5000).map((sec) => `b${sec}`));
      expect(await collect(a)).toHaveLength(4999);
    });

    it("ends after its catch-up when the pass fills it with alerts only", async () => {
      // An undecodable topic: an alert for each of its messages, after "b" has no more messages
      const recording = [
        ...events("b", [0, 1]),
        ...range(5000).flatMap((sec): IteratorResult[] => [
          ...events("a", [sec]),
          {
            type: "alert",
            connectionId: 1,
            alert: { severity: "error", message: "can't decode" },
          },
        ]),
      ];
      const open = Promise.withResolvers<void>();
      const shared = recordingSource(recording, { topics: "a", sec: 2, open: open.promise });
      const a = collect(shared.read("a", {}));
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Joins while the pass waits at 2 s and reads its catch-up only once the pass is done
      const b = shared.read("b", {});
      const first = await b.next();
      open.resolve();
      expect(await a).toHaveLength(5000);
      const rest = await collect(b);
      expect(first.value).toMatchObject({ msgEvent: { topic: "b" } });
      expect(rest).toEqual(["b1"]);
    });

    it.each(range(8))(
      "gets a window's tail when it joins %i microtasks after the window's source read ended",
      async (ticks) => {
        const recording = [...events("a", [0, 1, 2]), ...events("b", [0, 1, 2, 3])];
        let b: Promise<string[]> | undefined;
        const shared = recordingSource(recording, undefined, (topics) => {
          if (topics !== "a" || b) {
            return;
          }
          b = (async () => {
            for (let i = 0; i < ticks; i++) {
              await Promise.resolve();
            }
            return await collect(shared.read("b", {}));
          })();
        });

        expect(await collect(shared.read("a", {}))).toEqual(["a0", "a1", "a2"]);
        expect(await b).toEqual(["b0", "b1", "b2", "b3"]);
      },
    );
  });

  describe("playhead first", () => {
    const S = 1_000_000_000n;
    const sec = (n: bigint) => ({ sec: Number(n / S), nsec: Number(n % S) });
    const ns = (time: { sec: number; nsec: number } | undefined, fallback: bigint) =>
      time ? BigInt(time.sec) * S + BigInt(time.nsec) : fallback;

    it.each([
      [0n, 100n, 50n],
      [0n, 100n, 0n],
      [0n, 100n, 100n],
      [0n, 3600n, 1000n],
      [10n, 15n, 12n],
    ])(
      "windows of [%i s, %i s] around %i s cover it once, around, then before and after",
      (start, end, playhead) => {
        const windows = playheadWindows({
          start: sec(start * S),
          end: sec(end * S),
          playhead: sec(playhead * S),
        });
        const spans = windows.map((w) => [ns(w.start, start * S), ns(w.end, end * S)] as const);
        // Sorted by time they tile [start, end] without gaps or overlaps
        const sorted = spans.toSorted((x, y) => (x[0] < y[0] ? -1 : 1));
        expect(sorted[0]![0]).toBe(start * S);
        expect(sorted.at(-1)![1]).toBe(end * S);
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i]![0]).toBe(sorted[i - 1]![1] + 1n);
        }
        // The first window holds the playhead; each next one is right before or right after those
        // read so far, and the open ends are the recording's first and last windows
        const [first, ...rest] = spans;
        expect(first![0] <= playhead * S && playhead * S <= first![1]).toBe(true);
        let [lo, hi] = first!;
        for (const [from, to] of rest) {
          expect(to === lo - 1n || from === hi + 1n).toBe(true);
          lo = from < lo ? from : lo;
          hi = to > hi ? to : hi;
        }
        expect(windows.filter((w) => !w.start)).toHaveLength(1);
        expect(windows.filter((w) => !w.end)).toHaveLength(1);
      },
    );

    it("alternates earlier and later windows, each side doubling", () => {
      const windows = playheadWindows({
        start: sec(0n),
        end: sec(640n * S),
        playhead: sec(320n * S),
      });
      const spans = windows.map((w) => [(ns(w.start, 0n) + S - 1n) / S, ns(w.end, 640n * S) / S]);
      expect(spans).toEqual([
        [310n, 330n],
        [290n, 309n],
        [331n, 350n],
        [250n, 289n],
        [351n, 390n],
        [170n, 249n],
        [391n, 470n],
        [10n, 169n],
        [471n, 630n],
        [0n, 9n],
        [631n, 640n],
      ]);
    });

    const many = Array.from({ length: 100 }, (_, i) => i).flatMap((t) =>
      ["a", "b"].map((topic) => message(topic, t)),
    );

    function setupPlayhead({ gateAt }: { gateAt?: number } = {}) {
      const reads: { topics: string[]; start?: number; end?: number }[] = [];
      const gate = Promise.withResolvers<void>();
      let gated = false;
      const shared = new SharedRangeReads(
        async function* (topics, range) {
          reads.push({ topics: [...topics.keys()], start: range.start?.sec, end: range.end?.sec });
          for (const msgEvent of many) {
            const t = msgEvent.receiveTime.sec;
            if (
              !topics.has(msgEvent.topic) ||
              (range.start && compare(msgEvent.receiveTime, range.start) < 0) ||
              (range.end && compare(msgEvent.receiveTime, range.end) > 0)
            ) {
              continue;
            }
            if (t === gateAt && !gated && topics.size === 1 && topics.has("a")) {
              gated = true;
              await gate.promise;
            }
            yield { type: "message-event", msgEvent };
          }
        },
        () => ({
          start: { sec: 0, nsec: 0 },
          end: { sec: 99, nsec: 0 },
          playhead: { sec: 50, nsec: 0 },
        }),
      );
      const windows = playheadWindows({
        start: { sec: 0, nsec: 0 },
        end: { sec: 99, nsec: 0 },
        playhead: { sec: 50, nsec: 0 },
      });
      const windowOf = (t: number) =>
        windows.findIndex(
          ({ start, end }) =>
            (!start || compare(start, { sec: t, nsec: 0 }) <= 0) &&
            (!end || compare({ sec: t, nsec: 0 }, end) <= 0),
        );
      /** Delivered every second once, window by window, each window in time order */
      const expectPlayheadOrder = (seen: string[], topic: string) => {
        const times = seen.map((s) => Number(s.slice(topic.length)));
        expect(times.toSorted((x, y) => x - y)).toEqual(Array.from({ length: 100 }, (_, i) => i));
        for (let i = 1; i < times.length; i++) {
          const [w0, w1] = [windowOf(times[i - 1]!), windowOf(times[i]!)];
          expect(w1 > w0 || (w1 === w0 && times[i]! > times[i - 1]!)).toBe(true);
        }
        expect(windowOf(times[0]!)).toBe(0);
      };
      return { shared, reads, gate, expectPlayheadOrder, windows };
    }

    it("reads around the playhead first, then earlier and later windows, in one pass", async () => {
      const { shared, reads, expectPlayheadOrder, windows } = setupPlayhead();
      const [a, b] = await Promise.all([
        collect(shared.read("a", {}, { playheadFirst: true })),
        collect(shared.read("b", {}, { playheadFirst: true })),
      ]);
      expectPlayheadOrder(a, "a");
      expectPlayheadOrder(b, "b");
      // One source read per window, each for both topics
      expect(reads).toHaveLength(windows.length);
      expect(reads.every(({ topics }) => topics.join() === "a,b")).toBe(true);
    });

    // The pass waits at the start of the second window, or in its middle
    it.each([
      [20, 21],
      [30, 31],
    ])(
      "gives a late joiner everything once: what the pass read, then the pass (waits at %i s)",
      async (gateAt, readFirst) => {
        const { shared, gate, expectPlayheadOrder } = setupPlayhead({ gateAt });
        const a = shared.read("a", {}, { playheadFirst: true });
        const aSeen: string[] = [];
        // Read the playhead window (40 s to 60 s) and the next one up to where the pass waits
        for (;;) {
          const next = await a.next();
          if (next.done === true) {
            break;
          }
          if (next.value.type === "message-event") {
            aSeen.push(`a${next.value.msgEvent.receiveTime.sec}`);
            if (aSeen.length === readFirst) {
              break;
            }
          }
        }
        const b = collect(shared.read("b", {}, { playheadFirst: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        gate.resolve();
        const aRest = await collect(a);
        expectPlayheadOrder([...aSeen, ...aRest], "a");
        expectPlayheadOrder(await b, "b");
      },
    );

    it("reads ascending readers in their own pass, in time order", async () => {
      const { shared, reads, expectPlayheadOrder } = setupPlayhead();
      const [ascending, playhead] = await Promise.all([
        collect(shared.read("a", {})),
        collect(shared.read("b", {}, { playheadFirst: true })),
      ]);
      expect(ascending).toEqual(Array.from({ length: 100 }, (_, i) => `a${i}`));
      expectPlayheadOrder(playhead, "b");
      expect(reads.filter(({ topics }) => topics.includes("a"))).toEqual([
        { topics: ["a"], start: undefined, end: undefined },
      ]);
    });

    it("reads in time order when the player has no playhead", async () => {
      const shared = new SharedRangeReads(async function* (topics) {
        for (const msgEvent of messages) {
          if (topics.has(msgEvent.topic)) {
            yield { type: "message-event", msgEvent };
          }
        }
      });
      expect(await collect(shared.read("a", {}, { playheadFirst: true }))).toEqual([
        "a0",
        "a1",
        "a2",
        "a3",
      ]);
    });
  });
});
