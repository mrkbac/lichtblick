/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";
import type { Mock } from "vitest";

import { MessageEvent, SubscribeMessageRangeArgs } from "@lichtblick/suite";
import { useMessagesByTopic } from "@lichtblick/suite-base/PanelAPI";
import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import { useSubscribeMessageRange } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";

import { NormalizedLogMessage } from "./types";
import { mergeByReceiveTime, useLogMessages } from "./useLogMessages";

vi.mock("@lichtblick/suite-base/components/MessagePipeline");
vi.mock("@lichtblick/suite-base/components/PanelExtensionAdapter");
vi.mock("@lichtblick/suite-base/PanelAPI");

const at = (sec: number, topic = "/a"): NormalizedLogMessage => ({
  topic,
  receiveTime: { sec, nsec: 0 },
  stamp: { sec, nsec: 0 },
  level: 2,
  message: `${topic}@${sec}`,
});

const event = (sec: number, topic: string): MessageEvent => ({
  topic,
  schemaName: "rosgraph_msgs/Log",
  receiveTime: { sec, nsec: 0 },
  sizeInBytes: 0,
  message: { level: 2, msg: `${topic}@${sec}` },
});

describe("mergeByReceiveTime", () => {
  it("merges sorted arrays", () => {
    const merged = mergeByReceiveTime([[at(1), at(4)], [], [at(2), at(5)], [at(3)]]);
    expect(merged.map((m) => m.receiveTime.sec)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns a single array as-is", () => {
    const arr = [at(1)];
    expect(mergeByReceiveTime([[], arr])).toBe(arr);
  });
});

describe("useLogMessages", () => {
  let ctx: { playerState: { playerId: string; presence: PlayerPresence } };
  let rangeIterators: Map<string, (batch: MessageEvent[] | "done" | Error) => void>;
  let cancelByTopic: Map<string, Mock>;

  beforeEach(() => {
    vi.useFakeTimers();
    cancelByTopic = new Map();
    ctx = { playerState: { playerId: "p1", presence: PlayerPresence.PRESENT } };
    rangeIterators = new Map();
    (useMessagePipeline as Mock).mockImplementation((selector: (c: typeof ctx) => unknown) =>
      selector(ctx),
    );
    (useMessagesByTopic as Mock).mockReturnValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function withRange() {
    const subscribe = vi.fn(({ topic, onNewRangeIterator }: SubscribeMessageRangeArgs) => {
      // Async iterator fed by the test
      const queue: (MessageEvent[] | "done" | Error)[] = [];
      const waiting: (() => void)[] = [];
      const waitForBatch = async () => {
        await new Promise<void>((resolve) => waiting.push(resolve));
      };
      rangeIterators.set(topic, (batch) => {
        queue.push(batch);
        waiting.splice(0).forEach((resolve) => {
          resolve();
        });
      });
      void onNewRangeIterator(
        (async function* () {
          for (;;) {
            while (queue.length === 0) {
              await waitForBatch();
            }
            const next = queue.shift()!;
            if (next === "done") {
              return;
            }
            if (next instanceof Error) {
              throw next;
            }
            yield next;
          }
        })(),
      );
      const cancel = vi.fn();
      cancelByTopic.set(topic, cancel);
      return cancel;
    });
    (useSubscribeMessageRange as Mock).mockReturnValue(subscribe);
    return subscribe;
  }

  it("loads the whole range for every topic and merges them", async () => {
    const subscribe = withRange();
    const { result } = renderHook(() => useLogMessages(TOPICS));

    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(useMessagesByTopic).toHaveBeenLastCalledWith({
      topics: [],
      historySize: 50_000,
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      rangeIterators.get("/a")!([event(1, "/a"), event(3, "/a")]);
      rangeIterators.get("/b")!([event(2, "/b")]);
      rangeIterators.get("/a")!("done");
      rangeIterators.get("/b")!("done");
      await vi.runAllTimersAsync();
    });

    expect(result.current.items.map((m) => m.message)).toEqual(["/a@1", "/b@2", "/a@3"]);
    expect(result.current.loading).toBe(false);
  });

  it("stops loading and reports the error when reading fails, and can retry", async () => {
    const subscribe = withRange();
    const { result } = renderHook(() => useLogMessages(SINGLE_TOPIC));

    await act(async () => {
      rangeIterators.get("/a")!([event(1, "/a")]);
      rangeIterators.get("/a")!(new Error("read failed"));
      await vi.runAllTimersAsync();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("/a: read failed");
    // What was read before the failure stays visible
    expect(result.current.items).toHaveLength(1);

    const firstCancel = cancelByTopic.get("/a")!;
    act(() => {
      result.current.retry();
    });

    expect(firstCancel).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeUndefined();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      rangeIterators.get("/a")!([event(1, "/a"), event(2, "/a")]);
      rangeIterators.get("/a")!("done");
      await vi.runAllTimersAsync();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.items.map((m) => m.message)).toEqual(["/a@1", "/a@2"]);
  });

  it("publishes a new items array on every flush for a single topic", async () => {
    withRange();
    const { result } = renderHook(() => useLogMessages(SINGLE_TOPIC));

    await act(async () => {
      rangeIterators.get("/a")!([event(1, "/a")]);
      await vi.runAllTimersAsync();
    });
    const first = result.current.items;
    expect(first).toHaveLength(1);

    await act(async () => {
      rangeIterators.get("/a")!([event(2, "/a")]);
      await vi.runAllTimersAsync();
    });

    expect(result.current.items).not.toBe(first);
    expect(result.current.items).toHaveLength(2);
    expect(first).toHaveLength(1);
  });

  it("cancels topics that are no longer requested", async () => {
    withRange();
    const { rerender, result } = renderHook(({ topics }) => useLogMessages(topics), {
      initialProps: { topics: TOPICS },
    });
    await act(async () => {
      rangeIterators.get("/b")!([event(2, "/b")]);
      await vi.runAllTimersAsync();
    });

    rerender({ topics: ["/a"] });

    expect(cancelByTopic.get("/b")).toHaveBeenCalledTimes(1);
    expect(cancelByTopic.get("/a")).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });

  it("falls back to a rolling buffer when the source has no range support", () => {
    (useSubscribeMessageRange as Mock).mockReturnValue(vi.fn(() => () => {}));
    (useMessagesByTopic as Mock).mockReturnValue({
      "/a": [event(1, "/a"), event(3, "/a")],
      "/b": [event(2, "/b")],
    });

    const { result } = renderHook(() => useLogMessages(TOPICS));

    expect(useMessagesByTopic).toHaveBeenLastCalledWith({
      topics: TOPICS,
      historySize: 50_000,
    });
    expect(result.current.items.map((m) => m.message)).toEqual(["/a@1", "/b@2", "/a@3"]);
  });

  it("takes live updates at most every 250 ms, always ending on the latest", () => {
    (useSubscribeMessageRange as Mock).mockReturnValue(vi.fn(() => () => {}));
    let live = { "/a": [event(1, "/a")] };
    (useMessagesByTopic as Mock).mockImplementation(() => live);
    const { result, rerender } = renderHook(() => useLogMessages(SINGLE_TOPIC));
    const messages = () => result.current.items.map((m) => m.message);

    // after a quiet period the first update shows right away
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    live = { "/a": [event(1, "/a"), event(2, "/a")] };
    rerender();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(messages()).toEqual(["/a@1", "/a@2"]);

    live = { "/a": [event(1, "/a"), event(2, "/a"), event(3, "/a")] };
    rerender();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(messages()).toEqual(["/a@1", "/a@2"]);
    live = { "/a": [event(1, "/a"), event(2, "/a"), event(3, "/a"), event(4, "/a")] };
    rerender();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(messages()).toEqual(["/a@1", "/a@2", "/a@3", "/a@4"]);
  });
});

const TOPICS = ["/a", "/b"];
const SINGLE_TOPIC = ["/a"];
