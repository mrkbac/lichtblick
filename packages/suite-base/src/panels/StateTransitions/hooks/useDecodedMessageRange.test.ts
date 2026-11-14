/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";
import type { Mock } from "vitest";

import { MessageEvent, SubscribeMessageRangeArgs } from "@lichtblick/suite";
import { useCachedGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { useSubscribeMessageRange } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import useGlobalVariables from "@lichtblick/suite-base/hooks/useGlobalVariables";
import MessageEventBuilder from "@lichtblick/suite-base/testing/builders/MessageEventBuilder";
import PlayerBuilder from "@lichtblick/suite-base/testing/builders/PlayerBuilder";

import { PathSamplesByPath, useDecodedMessageRange } from "./useDecodedMessageRange";

vi.mock("@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems");
vi.mock("@lichtblick/suite-base/components/PanelExtensionAdapter");
vi.mock("@lichtblick/suite-base/hooks/useGlobalVariables");

describe("useDecodedMessageRange", () => {
  let mockSubscribeMessageRange: Mock;
  let mockDecode: Mock;
  let mockCancel: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockCancel = vi.fn();
    mockSubscribeMessageRange = vi.fn().mockReturnValue(mockCancel);
    // Decodes a path to the whole message, so tests can check which messages were kept.
    mockDecode = vi.fn((path: string, message: MessageEvent) => [{ value: message, path }]);

    (useSubscribeMessageRange as Mock).mockReturnValue(mockSubscribeMessageRange);
    (useCachedGetMessagePathDataItems as Mock).mockReturnValue(mockDecode);
    (useGlobalVariables as Mock).mockReturnValue({ globalVariables: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function rangeArgs(topic: string): SubscribeMessageRangeArgs {
    const call = mockSubscribeMessageRange.mock.calls.findLast(
      ([args]) => (args as SubscribeMessageRangeArgs).topic === topic,
    ) as [SubscribeMessageRangeArgs] | undefined;
    if (call == undefined) {
      throw new Error(`No subscription found for topic "${topic}"`);
    }
    return call[0];
  }

  async function simulateBatches(topic: string, batches: MessageEvent[][]): Promise<void> {
    await rangeArgs(topic).onNewRangeIterator(
      (async function* () {
        for (const batch of batches) {
          yield batch;
        }
      })(),
    );
  }

  const valuesOf = (current: PathSamplesByPath[], path: string) =>
    current[0]?.[path]?.map((sample) => sample.queriedData[0]?.value);

  it("subscribes to each topic and cancels on unmount", () => {
    const topicA = PlayerBuilder.topic().name;
    const topicB = PlayerBuilder.topic().name;

    const { unmount } = renderHook(() =>
      useDecodedMessageRange([topicA, topicB], [`${topicA}.field`, `${topicB}.field`]),
    );

    expect(mockSubscribeMessageRange).toHaveBeenCalledTimes(2);
    expect(mockSubscribeMessageRange).toHaveBeenCalledWith(
      expect.objectContaining({ topic: topicA }),
    );
    expect(mockSubscribeMessageRange).toHaveBeenCalledWith(
      expect.objectContaining({ topic: topicB }),
    );
    unmount();
    expect(mockCancel).toHaveBeenCalledTimes(2);
  });

  it("does not subscribe without topics", () => {
    const { result } = renderHook(() => useDecodedMessageRange([], []));

    expect(result.current).toEqual([{}]);
    expect(mockSubscribeMessageRange).not.toHaveBeenCalled();
  });

  it("keeps decoded samples per path, with the timestamps", async () => {
    const topic = PlayerBuilder.topic().name;
    const path = `${topic}.field`;
    const { result } = renderHook(() => useDecodedMessageRange([topic], [path]));

    const msgs = [
      MessageEventBuilder.messageEvent({
        topic,
        message: { header: { stamp: { sec: 1, nsec: 2 } } },
      }),
      MessageEventBuilder.messageEvent({ topic }),
    ];
    await act(async () => {
      await simulateBatches(topic, [msgs]);
    });

    expect(valuesOf(result.current, path)).toEqual(msgs);
    expect(result.current[0]?.[path]?.[0]).toEqual(
      expect.objectContaining({
        receiveTime: msgs[0]!.receiveTime,
        headerStamp: { sec: 1, nsec: 2 },
      }),
    );
  });

  it("decodes each message once however many flushes happen while loading", async () => {
    const topic = PlayerBuilder.topic().name;
    const path = `${topic}.field`;
    const { result } = renderHook(() => useDecodedMessageRange([topic], [path]));

    const batches = Array.from({ length: 20 }, () => [
      MessageEventBuilder.messageEvent({ topic }),
      MessageEventBuilder.messageEvent({ topic }),
    ]);
    await act(async () => {
      await rangeArgs(topic).onNewRangeIterator(
        (async function* () {
          for (const batch of batches) {
            yield batch;
            // Let the flush timer fire between batches, as during a slow load
            vi.advanceTimersByTime(250);
          }
        })(),
      );
    });

    expect(mockDecode).toHaveBeenCalledTimes(40);
    expect(valuesOf(result.current, path)).toEqual(batches.flat());
  });

  it("replaces a topic's data when a new range iterator is provided", async () => {
    const topic = PlayerBuilder.topic().name;
    const path = `${topic}.field`;
    const { result } = renderHook(() => useDecodedMessageRange([topic], [path]));

    await act(async () => {
      await simulateBatches(topic, [[MessageEventBuilder.messageEvent({ topic })]]);
    });
    const second = [MessageEventBuilder.messageEvent({ topic })];
    await act(async () => {
      await simulateBatches(topic, [second]);
    });

    expect(valuesOf(result.current, path)).toEqual(second);
  });

  it("only subscribes added topics and only drops removed ones", async () => {
    const topicA = PlayerBuilder.topic().name;
    const topicB = PlayerBuilder.topic().name;
    const cancelA = vi.fn();
    mockSubscribeMessageRange.mockReturnValueOnce(cancelA);

    const { result, rerender } = renderHook(
      ({ topics, paths }) => useDecodedMessageRange(topics, paths),
      { initialProps: { topics: [topicA], paths: [`${topicA}.field`] } },
    );
    const msgsA = [MessageEventBuilder.messageEvent({ topic: topicA })];
    await act(async () => {
      await simulateBatches(topicA, [msgsA]);
    });

    mockSubscribeMessageRange.mockClear();
    rerender({ topics: [topicA, topicB], paths: [`${topicA}.field`, `${topicB}.field`] });
    expect(mockSubscribeMessageRange).toHaveBeenCalledTimes(1);
    expect(mockSubscribeMessageRange).toHaveBeenCalledWith(
      expect.objectContaining({ topic: topicB }),
    );

    const msgsB = [MessageEventBuilder.messageEvent({ topic: topicB })];
    await act(async () => {
      await simulateBatches(topicB, [msgsB]);
    });
    expect(valuesOf(result.current, `${topicA}.field`)).toEqual(msgsA);
    expect(valuesOf(result.current, `${topicB}.field`)).toEqual(msgsB);

    rerender({ topics: [topicB], paths: [`${topicB}.field`] });
    expect(cancelA).toHaveBeenCalledTimes(1);
    expect(result.current[0]?.[`${topicA}.field`]).toBeUndefined();
    expect(valuesOf(result.current, `${topicB}.field`)).toEqual(msgsB);
  });

  it("reloads a topic when the paths reading it change", async () => {
    const topic = PlayerBuilder.topic().name;
    const { rerender } = renderHook(({ paths }) => useDecodedMessageRange([topic], paths), {
      initialProps: { paths: [`${topic}.a`] },
    });

    mockSubscribeMessageRange.mockClear();
    rerender({ paths: [`${topic}.a`] });
    expect(mockSubscribeMessageRange).not.toHaveBeenCalled();

    rerender({ paths: [`${topic}.a`, `${topic}.b`] });
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockSubscribeMessageRange).toHaveBeenCalledTimes(1);
  });

  it("reloads paths with variables when the variables change", () => {
    const topic = PlayerBuilder.topic().name;
    const { rerender } = renderHook(() => useDecodedMessageRange([topic], [`${topic}.a[$index]`]));

    mockSubscribeMessageRange.mockClear();
    (useGlobalVariables as Mock).mockReturnValue({ globalVariables: { index: 1 } });
    rerender();
    expect(mockSubscribeMessageRange).toHaveBeenCalledTimes(1);
  });
});
