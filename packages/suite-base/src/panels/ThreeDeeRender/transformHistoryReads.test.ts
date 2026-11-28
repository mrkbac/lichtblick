// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { toNanoSec } from "@foxglove/rostime";

import { MessageEvent, SubscribeMessageRangeArgs } from "@lichtblick/suite";
import MessageEventBuilder from "@lichtblick/suite-base/testing/builders/MessageEventBuilder";

import { readTransformRange, readTransformsBefore } from "./transformHistoryReads";

const sec = 1_000_000_000n;

/** A source with one message per second on every topic, from 0 s to 1000 s */
function fakeSource() {
  const reads: { topic: string; start?: bigint; end?: bigint }[] = [];
  const subscribeRange = vi.fn((args: SubscribeMessageRangeArgs) => {
    const start = args.start ? toNanoSec(args.start) : 0n;
    const end = args.end ? toNanoSec(args.end) : 1000n * sec;
    reads.push({ topic: args.topic, start, end });
    void args.onNewRangeIterator(
      (async function* () {
        const batch: MessageEvent[] = [];
        for (let t = (start + sec - 1n) / sec; t * sec <= end; t++) {
          batch.push(
            MessageEventBuilder.messageEvent({
              topic: args.topic,
              receiveTime: { sec: Number(t), nsec: 0 },
            }),
          );
        }
        yield batch;
      })(),
    );
    return () => {};
  });
  return { subscribeRange, reads };
}

describe("readTransformRange", () => {
  it("reads every topic and resolves once all are done", async () => {
    const { subscribeRange } = fakeSource();
    const onBatch = vi.fn();
    const onTopicDone = vi.fn();
    await readTransformRange({
      subscribeRange,
      topics: [{ topic: "/a" }, { topic: "/b" }],
      start: 10n * sec,
      end: 12n * sec,
      onBatch,
      onTopicDone,
      signal: new AbortController().signal,
    });
    expect(onBatch).toHaveBeenCalledTimes(2);
    expect(onBatch.mock.calls[0]![0]).toHaveLength(3);
    expect(onTopicDone.mock.calls.map(([source]) => source.topic)).toEqual(["/a", "/b"]);
  });

  it("reads the next batch only once an async batch callback settles", async () => {
    const events: string[] = [];
    const subscribeRange = vi.fn((args: SubscribeMessageRangeArgs) => {
      void args.onNewRangeIterator(
        (async function* () {
          for (const second of [1, 2]) {
            events.push(`read ${second}`);
            yield [MessageEventBuilder.messageEvent({ receiveTime: { sec: second, nsec: 0 } })];
          }
        })(),
      );
      return () => {};
    });
    await readTransformRange({
      subscribeRange,
      topics: [{ topic: "/points" }],
      onBatch: async (batch) => {
        await Promise.resolve();
        events.push(`done ${batch[0]!.receiveTime.sec}`);
      },
      signal: new AbortController().signal,
    });
    expect(events).toEqual(["read 1", "done 1", "read 2", "done 2"]);
  });

  it("resolves at once for a source without ranges", async () => {
    const subscribeRange = vi.fn(() => () => {});
    await readTransformRange({
      subscribeRange,
      topics: [{ topic: "/a" }],
      onBatch: vi.fn(),
      signal: new AbortController().signal,
    });
    expect(subscribeRange).toHaveBeenCalledTimes(1);
  });
});

describe("readTransformRange failures", () => {
  // Delivers one batch, then the read fails
  const failingRange = () =>
    vi.fn((args: SubscribeMessageRangeArgs & { rethrowErrors?: boolean }) => {
      expect(args.rethrowErrors).toBe(true);
      void args.onNewRangeIterator(
        (async function* () {
          yield [MessageEventBuilder.messageEvent({ topic: args.topic })];
          throw new Error("read failed");
        })(),
      );
      return () => {};
    });

  it("does not report a topic that failed mid-read as done", async () => {
    const onBatch = vi.fn();
    const onTopicDone = vi.fn();
    const onTopicFailed = vi.fn();
    await readTransformRange({
      subscribeRange: failingRange(),
      topics: [{ topic: "/tf" }],
      onBatch,
      onTopicDone,
      onTopicFailed,
      signal: new AbortController().signal,
    });
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onTopicDone).not.toHaveBeenCalled();
    // Told apart from a cancelled read, so what it read can still be kept
    expect(onTopicFailed).toHaveBeenCalledWith({ topic: "/tf" });
    expect(console.error).toHaveBeenCalled();
    (console.error as ReturnType<typeof vi.fn>).mockClear();
  });

  it("settles when the batch callback throws", async () => {
    await readTransformRange({
      subscribeRange: fakeSource().subscribeRange,
      topics: [{ topic: "/tf" }],
      onBatch: () => {
        throw new Error("consumer failed");
      },
      signal: new AbortController().signal,
    });
    expect(console.error).toHaveBeenCalled();
    (console.error as ReturnType<typeof vi.fn>).mockClear();
  });
});

describe("readTransformsBefore", () => {
  it("reads only the first window when no frame is missing", async () => {
    const { subscribeRange, reads } = fakeSource();
    await readTransformsBefore({
      subscribeRange,
      topics: [{ topic: "/tf" }],
      time: 500n * sec,
      floor: -1n,
      isMissing: () => false,
      onBatch: vi.fn(),
      signal: new AbortController().signal,
    });
    expect(reads).toEqual([{ topic: "/tf", start: 498n * sec, end: 500n * sec }]);
  });

  it("widens the window over older, non-overlapping slices while a frame is missing", async () => {
    const { subscribeRange, reads } = fakeSource();
    let windows = 0;
    await readTransformsBefore({
      subscribeRange,
      topics: [{ topic: "/tf" }],
      time: 500n * sec,
      floor: -1n,
      isMissing: () => ++windows < 3,
      onBatch: vi.fn(),
      signal: new AbortController().signal,
    });
    expect(reads.map(({ start, end }) => [start, end])).toEqual([
      [498n * sec, 500n * sec],
      [492n * sec, 498n * sec - 1n],
      [468n * sec, 492n * sec - 1n],
    ]);
  });

  it("reads back to the complete history for a frame silent longer than every window", async () => {
    const { subscribeRange, reads } = fakeSource();
    await readTransformsBefore({
      subscribeRange,
      topics: [{ topic: "/tf" }],
      time: 500n * sec,
      floor: 100n * sec,
      isMissing: () => true,
      onBatch: vi.fn(),
      signal: new AbortController().signal,
    });
    expect(reads.at(-1)).toEqual({ topic: "/tf", start: 100n * sec, end: 372n * sec - 1n });
  });

  it("stops widening and reports failure when a window read fails", async () => {
    const subscribeRange = vi.fn(
      (args: SubscribeMessageRangeArgs & { rethrowErrors?: boolean }) => {
        void args.onNewRangeIterator(
          // oxlint-disable-next-line require-yield -- an iterator that fails before any batch
          (async function* () {
            throw new Error("read failed");
          })(),
        );
        return () => {};
      },
    );
    const ok = await readTransformsBefore({
      subscribeRange,
      topics: [{ topic: "/tf" }],
      time: 500n * sec,
      floor: -1n,
      isMissing: () => true,
      onBatch: vi.fn(),
      signal: new AbortController().signal,
    });
    expect(ok).toBe(false);
    expect(subscribeRange).toHaveBeenCalledTimes(1);
    (console.error as ReturnType<typeof vi.fn>).mockClear();
  });

  it("starts with a window as long as the longest decay time", async () => {
    const { subscribeRange, reads } = fakeSource();
    let windows = 0;
    await readTransformsBefore({
      subscribeRange,
      topics: [{ topic: "/tf" }],
      time: 500n * sec,
      floor: -1n,
      minLookback: 60n * sec,
      isMissing: () => ++windows < 2,
      onBatch: vi.fn(),
      signal: new AbortController().signal,
    });
    expect(reads.map(({ start, end }) => [start, end])).toEqual([
      [440n * sec, 500n * sec],
      [372n * sec, 440n * sec - 1n],
    ]);
  });

  it("never reads before the complete history", async () => {
    const { subscribeRange, reads } = fakeSource();
    await readTransformsBefore({
      subscribeRange,
      topics: [{ topic: "/tf" }],
      time: 500n * sec,
      floor: 495n * sec,
      isMissing: () => true,
      onBatch: vi.fn(),
      signal: new AbortController().signal,
    });
    expect(reads.map(({ start, end }) => [start, end])).toEqual([
      [498n * sec, 500n * sec],
      [495n * sec, 498n * sec - 1n],
    ]);
  });
});
