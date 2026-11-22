/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time, compare } from "@foxglove/rostime";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import { IteratorResult } from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";
import RosTimeBuilder from "@lichtblick/suite-base/testing/builders/RosTimeBuilder";
import { BasicBuilder } from "@lichtblick/test-builders";

import { useTopicMessageNavigation } from "./useTopicMessageNavigation";

vi.mock("@lichtblick/suite-base/components/MessagePipeline");
vi.mock("@lichtblick/log", () => ({
  __esModule: true,
  default: {
    getLogger: () => ({
      warn: vi.fn(),
    }),
  },
}));

type MessagePipelineMockData = {
  currentTime?: Time;
  startTime?: Time;
  endTime?: Time;
  topicStats?: Map<
    string,
    { numMessages: number; firstMessageTime?: Time; lastMessageTime?: Time }
  >;
  pausePlayback?: Mock;
  seekPlayback?: Mock;
  messages?: Time[];
  /** When true, getMessageAtTime answers from `messages`; otherwise it resolves undefined (unsupported). */
  supportsMessageAtTime?: boolean;
  /** When true, the player offers a payload-free inspection iterator over `messages`. */
  supportsInspection?: boolean;
  customIterator?: () => AsyncIterableIterator<Readonly<IteratorResult>>;
};

type SetupOptions = {
  topicName?: string;
  selected?: boolean;
  isTopicSubscribed?: boolean;
  pipelineData?: MessagePipelineMockData;
};

function createMockBatchIterator(
  messages: Time[],
  topicName: string,
  onYield: () => void = () => {},
): (
  topic: string,
  opts?: { start?: Time; end?: Time },
) => AsyncIterableIterator<Readonly<IteratorResult>> {
  return (_topic: string, opts?: { start?: Time; end?: Time }) =>
    (async function* () {
      for (const receiveTime of messages) {
        // Filter messages by time range if provided
        if (opts?.start && compare(receiveTime, opts.start) < 0) {
          continue;
        }
        if (opts?.end && compare(receiveTime, opts.end) >= 0) {
          continue;
        }

        onYield();
        yield {
          type: "message-event" as const,
          msgEvent: {
            receiveTime,
            topic: topicName,
            schemaName: "test",
            message: {},
            sizeInBytes: 0,
          },
        };
      }
    })();
}

function createThrowingIterator(
  error: unknown,
  topicName: string,
): () => AsyncIterableIterator<Readonly<IteratorResult>> {
  return () =>
    (async function* () {
      yield {
        type: "message-event" as const,
        msgEvent: {
          receiveTime: { sec: 0, nsec: 0 },
          topic: topicName,
          schemaName: "test",
          message: {},
          sizeInBytes: 0,
        },
      };
      throw error;
    })();
}

function setup(options: SetupOptions = {}) {
  const {
    topicName = `/${BasicBuilder.string()}`,
    selected = true,
    isTopicSubscribed = true,
    pipelineData = {},
  } = options;

  const hasCurrentTime = "currentTime" in pipelineData;
  const hasTopicStats = "topicStats" in pipelineData;

  const currentTime = hasCurrentTime ? pipelineData.currentTime : RosTimeBuilder.time();
  const topicStats = hasTopicStats
    ? pipelineData.topicStats
    : new Map([[topicName, { numMessages: BasicBuilder.number() }]]);
  const {
    startTime,
    endTime,
    pausePlayback = vi.fn(),
    seekPlayback = vi.fn(),
    messages = [],
    supportsMessageAtTime = false,
    supportsInspection = false,
    customIterator,
  } = pipelineData;

  const consumption = { yielded: 0 };
  const getBatchIterator = customIterator
    ? vi.fn(customIterator)
    : vi.fn(
        createMockBatchIterator(messages, topicName, () => {
          consumption.yielded++;
        }),
      );
  const inspect = createMockBatchIterator(messages, topicName, () => {
    consumption.yielded++;
  });
  const getInspectionIterator = supportsInspection
    ? vi.fn((topics: readonly string[], opts?: { start?: Time; end?: Time }) =>
        inspect(topics[0]!, opts),
      )
    : undefined;
  const getMessageAtTime = vi.fn(async (topic: string, time: Time) => {
    if (!supportsMessageAtTime) {
      return undefined;
    }
    const receiveTime = messages.filter((t) => compare(t, time) <= 0).at(-1);
    return receiveTime
      ? { topic, receiveTime, schemaName: "test", message: {}, sizeInBytes: 0 }
      : undefined;
  });

  (useMessagePipeline as Mock).mockImplementation((selector) =>
    selector({
      playerState: {
        activeData: {
          currentTime,
          startTime,
          endTime,
          topicStats,
        },
      },
      pausePlayback,
      seekPlayback,
      getBatchIterator,
      getInspectionIterator,
      getMessageAtTime,
    }),
  );

  const props = {
    topicName,
    selected,
    isTopicSubscribed,
  };

  const hookResult = renderHook(() => useTopicMessageNavigation(props));

  return {
    ...hookResult,
    topicName,
    pausePlayback,
    seekPlayback,
    getBatchIterator,
    getMessageAtTime,
    getInspectionIterator,
    consumption,
  };
}

describe("useTopicMessageNavigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("canNavigateNext", () => {
    it("returns false when currentTime is undefined", async () => {
      // Given
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { result } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: undefined,
          topicStats: new Map([[topicName, { numMessages: 1 }]]),
        },
      });

      // Then
      expect(result.current.canNavigateNext).toBe(false);
    });

    it("returns false when topicStats is undefined", async () => {
      // Given / When
      const { result } = setup({
        selected: false,
        pipelineData: {
          currentTime: RosTimeBuilder.time(),
          topicStats: undefined,
        },
      });

      // Then
      expect(result.current.canNavigateNext).toBe(false);
    });

    it("returns false when currentTime equals endTime", async () => {
      // Given
      const time = RosTimeBuilder.time();
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { result } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: time,
          startTime: { sec: time.sec - 1, nsec: 0 },
          endTime: time,
          topicStats: new Map([[topicName, { numMessages: 2 }]]),
        },
      });

      // Then
      expect(result.current.canNavigateNext).toBe(false);
    });

    it("returns false when currentTime is past endTime", async () => {
      // Given
      const endTime = RosTimeBuilder.time();
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { result } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: { sec: endTime.sec + 1, nsec: 0 },
          endTime,
          topicStats: new Map([[topicName, { numMessages: 1 }]]),
        },
      });

      // Then
      expect(result.current.canNavigateNext).toBe(false);
    });

    it("returns true when before lastMessageTime", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { result } = setup({
        topicName,
        selected: true,
        pipelineData: {
          currentTime: t1,
          topicStats: new Map([[topicName, { numMessages: 2, lastMessageTime: t2 }]]),
        },
      });

      // Then
      await waitFor(() => {
        expect(result.current.canNavigateNext).toBe(true);
      });
    });

    it("returns false after discovering lastMessageTime via boundary discovery", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { result } = setup({
        topicName,
        selected: true,
        pipelineData: {
          currentTime: t2,
          topicStats: new Map([[topicName, { numMessages: 2 }]]),
          messages: [t1, t2],
        },
      });

      // Then - starts disabled until boundaries discovered, stays disabled when at last message
      expect(result.current.canNavigateNext).toBe(false);

      await waitFor(() => {
        expect(result.current.canNavigateNext).toBe(false);
      });
    });
  });

  describe("canNavigatePrevious", () => {
    it("returns false when currentTime is undefined", async () => {
      // Given
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { result } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: undefined,
          topicStats: new Map([[topicName, { numMessages: 1 }]]),
        },
      });

      // Then
      expect(result.current.canNavigatePrevious).toBe(false);
    });

    it("returns false when topicStats is undefined", async () => {
      // Given / When
      const { result } = setup({
        selected: false,
        pipelineData: {
          currentTime: RosTimeBuilder.time(),
          topicStats: undefined,
        },
      });

      // Then
      expect(result.current.canNavigatePrevious).toBe(false);
    });

    it("returns false when currentTime equals startTime", async () => {
      // Given
      const time = RosTimeBuilder.time();
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { result } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: time,
          startTime: time,
          endTime: { sec: time.sec + 1, nsec: 0 },
          topicStats: new Map([[topicName, { numMessages: 2 }]]),
        },
      });

      // Then
      expect(result.current.canNavigatePrevious).toBe(false);
    });

    it("returns false after discovering firstMessageTime via boundary discovery", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { result } = setup({
        topicName,
        selected: true,
        pipelineData: {
          currentTime: t1,
          topicStats: new Map([[topicName, { numMessages: 2 }]]),
          messages: [t1, t2],
        },
      });

      // Then - starts disabled until boundaries discovered, stays disabled when at first message
      expect(result.current.canNavigatePrevious).toBe(false);

      await waitFor(() => {
        expect(result.current.canNavigatePrevious).toBe(false);
      });
    });

    it("returns true when after firstMessageTime", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { result } = setup({
        topicName,
        selected: true,
        pipelineData: {
          currentTime: t2,
          topicStats: new Map([[topicName, { numMessages: 2 }]]),
          messages: [t1, t2],
        },
      });

      // Then - starts disabled, becomes enabled after discovery
      expect(result.current.canNavigatePrevious).toBe(false);

      await waitFor(() => {
        expect(result.current.canNavigatePrevious).toBe(true);
      });
    });
  });

  describe("handleNextMessage", () => {
    it("does not seek when iterator is not found", async () => {
      // Given
      const topicName = `/${BasicBuilder.string()}`;
      const seekPlayback = vi.fn();
      const getBatchIterator = vi.fn(() => undefined);

      (useMessagePipeline as Mock).mockImplementation((selector) =>
        selector({
          playerState: {
            activeData: {
              currentTime: RosTimeBuilder.time(),
              topicStats: new Map([[topicName, { numMessages: BasicBuilder.number() }]]),
            },
          },
          pausePlayback: vi.fn(),
          seekPlayback,
          getBatchIterator, // ← Use the custom mock
        }),
      );

      const { result } = renderHook(() =>
        useTopicMessageNavigation({
          topicName,
          selected: false,
          isTopicSubscribed: false,
        }),
      );

      // When
      await act(async () => {
        await result.current.handleNextMessage();
      });

      // Then
      expect(seekPlayback).not.toHaveBeenCalled();
      expect(result.current.isNavigating).toBe(false);
    });

    it("seeks to the next message time", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      const { result, pausePlayback, seekPlayback } = setup({
        topicName,
        selected: true,
        pipelineData: {
          currentTime: t1,
          topicStats: new Map([[topicName, { numMessages: 2 }]]),
          messages: [t1, t2],
        },
      });

      // When
      await act(async () => {
        await result.current.handleNextMessage();
      });

      // Then
      expect(pausePlayback).toHaveBeenCalled();
      expect(seekPlayback).toHaveBeenCalledWith(t2);
    });

    it("does not seek when there is no next message", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      const { result, pausePlayback, seekPlayback } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: t1,
          topicStats: new Map([[topicName, { numMessages: 1 }]]),
          messages: [t1],
        },
      });

      // When
      await act(async () => {
        await result.current.handleNextMessage();
      });

      // Then
      expect(pausePlayback).not.toHaveBeenCalled();
      expect(seekPlayback).not.toHaveBeenCalled();
    });

    it("reads only the next message once the last message time is known", async () => {
      // Given
      const messages: Time[] = [1, 2, 3, 4].map((sec) => ({ sec, nsec: 0 }));
      const topicName = `/${BasicBuilder.string()}`;

      const { result, seekPlayback, consumption } = setup({
        topicName,
        selected: true,
        pipelineData: {
          currentTime: messages[0],
          // Stats know both ends, so boundary discovery reads nothing
          topicStats: new Map([
            [
              topicName,
              { numMessages: 4, firstMessageTime: messages[0], lastMessageTime: messages[3] },
            ],
          ]),
          messages,
        },
      });

      // When
      await act(async () => {
        await result.current.handleNextMessage();
      });

      // Then - the message at currentTime is skipped, then exactly one is taken
      expect(seekPlayback).toHaveBeenCalledWith(messages[1]);
      expect(consumption.yielded).toBe(2);
    });

    it("reads times through the payload-free inspection iterator when the player has one", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      const { result, seekPlayback, getBatchIterator, getInspectionIterator } = setup({
        topicName,
        selected: true,
        pipelineData: {
          currentTime: t1,
          topicStats: new Map([
            [topicName, { numMessages: 2, firstMessageTime: t1, lastMessageTime: t2 }],
          ]),
          messages: [t1, t2],
          supportsInspection: true,
        },
      });

      // When
      await act(async () => {
        await result.current.handleNextMessage();
      });

      // Then
      expect(seekPlayback).toHaveBeenCalledWith(t2);
      expect(getInspectionIterator).toHaveBeenCalledWith([topicName], { start: t1 });
      expect(getBatchIterator).not.toHaveBeenCalled();
    });
  });

  describe("handlePreviousMessage", () => {
    it("seeks to the previous message time", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      const { result, pausePlayback, seekPlayback } = setup({
        topicName,
        selected: true,
        pipelineData: {
          currentTime: t2,
          topicStats: new Map([[topicName, { numMessages: 2 }]]),
          messages: [t1, t2],
        },
      });

      // When
      await act(async () => {
        await result.current.handlePreviousMessage();
      });

      // Then
      expect(pausePlayback).toHaveBeenCalled();
      expect(seekPlayback).toHaveBeenCalledWith(t1);
    });

    it("does not seek when there is no previous message", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      const { result, pausePlayback, seekPlayback } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: t1,
          topicStats: new Map([[topicName, { numMessages: 1 }]]),
          messages: [t1],
        },
      });

      // When
      await act(async () => {
        await result.current.handlePreviousMessage();
      });

      // Then
      expect(pausePlayback).not.toHaveBeenCalled();
      expect(seekPlayback).not.toHaveBeenCalled();
    });

    it("searches from start to currentTime when window reaches boundary", async () => {
      // Given
      const startTime: Time = { sec: 0, nsec: 0 };
      const t1: Time = { sec: 2, nsec: 0 };
      const currentTime: Time = { sec: 10, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      const { result, pausePlayback, seekPlayback } = setup({
        topicName,
        selected: true,
        pipelineData: {
          startTime,
          currentTime,
          topicStats: new Map([[topicName, { numMessages: 2 }]]),
          messages: [t1],
        },
      });

      // When
      await act(async () => {
        await result.current.handlePreviousMessage();
      });

      // Then
      expect(pausePlayback).toHaveBeenCalled();
      expect(seekPlayback).toHaveBeenCalledWith(t1);
    });

    it("finds a far-back previous message with getMessageAtTime, without reading from the start", async () => {
      // Given
      const startTime: Time = { sec: 0, nsec: 0 };
      const t1: Time = { sec: 1, nsec: 0 };
      const currentTime: Time = { sec: 1000, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      const { result, seekPlayback, getBatchIterator, getMessageAtTime } = setup({
        topicName,
        selected: true,
        pipelineData: {
          startTime,
          currentTime,
          // Stats know the first message, so boundary discovery reads nothing
          topicStats: new Map([[topicName, { numMessages: 2, firstMessageTime: t1 }]]),
          messages: [t1],
          supportsMessageAtTime: true,
        },
      });

      // When
      await act(async () => {
        await result.current.handlePreviousMessage();
      });

      // Then
      expect(getMessageAtTime).toHaveBeenCalledWith(
        topicName,
        { sec: 999, nsec: 999_999_999 },
        expect.any(AbortSignal),
      );
      expect(seekPlayback).toHaveBeenCalledWith(t1);
      expect(getBatchIterator).not.toHaveBeenCalled();
    });

    it("widens windows geometrically without reading from the start when getMessageAtTime is unsupported", async () => {
      // Given
      const startTime: Time = { sec: 0, nsec: 0 };
      const target: Time = { sec: 900, nsec: 0 };
      const currentTime: Time = { sec: 1000, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      const { result, seekPlayback, getBatchIterator } = setup({
        topicName,
        selected: true,
        pipelineData: {
          startTime,
          currentTime,
          topicStats: new Map([
            [topicName, { numMessages: 2, firstMessageTime: { sec: 10, nsec: 0 } }],
          ]),
          messages: [{ sec: 10, nsec: 0 }, target],
        },
      });

      // When
      await act(async () => {
        await result.current.handlePreviousMessage();
      });

      // Then
      expect(seekPlayback).toHaveBeenCalledWith(target);
      for (const [, opts] of getBatchIterator.mock.calls) {
        expect(compare(opts!.start!, startTime)).toBeGreaterThan(0);
      }
      // Windows don't overlap: each one ends where the previous one started
      const windows = getBatchIterator.mock.calls.map(([, opts]) => opts!);
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i]!.end).toEqual(windows[i - 1]!.start);
      }
    });

    it("does not seek when iterator is not found", async () => {
      // Given
      const topicName = `/${BasicBuilder.string()}`;
      const seekPlayback = vi.fn();
      const getBatchIterator = vi.fn(() => undefined);

      (useMessagePipeline as Mock).mockImplementation((selector) =>
        selector({
          playerState: {
            activeData: {
              currentTime: RosTimeBuilder.time(),
              topicStats: new Map([[topicName, { numMessages: BasicBuilder.number() }]]),
            },
          },
          pausePlayback: vi.fn(),
          seekPlayback,
          getBatchIterator,
        }),
      );

      const { result } = renderHook(() =>
        useTopicMessageNavigation({
          topicName,
          selected: true,
          isTopicSubscribed: false,
        }),
      );

      // When
      await act(async () => {
        await result.current.handleNextMessage();
      });

      // Then
      expect(seekPlayback).not.toHaveBeenCalled();
      expect(result.current.isNavigating).toBe(false);
    });

    it("searches from firstMessageTime to currentTime when window reaches cached boundary", async () => {
      // Given
      const startTime: Time = { sec: 0, nsec: 0 };
      const t1: Time = { sec: 2, nsec: 0 };
      const t2: Time = { sec: 3, nsec: 0 };
      const currentTime: Time = { sec: 10, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      const { result, pausePlayback, seekPlayback, getBatchIterator } = setup({
        topicName,
        selected: true,
        pipelineData: {
          startTime,
          currentTime,
          topicStats: new Map([[topicName, { numMessages: 2, firstMessageTime: t1 }]]),
          messages: [t1, t2],
        },
      });

      // Let boundary discovery (answered from topicStats) land in the cache.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // When
      await act(async () => {
        await result.current.handlePreviousMessage();
      });

      // Then
      expect(pausePlayback).toHaveBeenCalled();
      expect(seekPlayback).toHaveBeenCalledWith(t2);

      // The last window is clamped to the topic's first message, never the recording start
      expect(getBatchIterator).toHaveBeenLastCalledWith(topicName, {
        start: t1,
        end: expect.anything(),
      });
    });

    it("ignores messages at or after currentTime during window search", async () => {
      // Given
      const t1 = { sec: 9, nsec: 900_000_000 }; // 9.9s
      const currentTime = { sec: 10, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      const { result, pausePlayback, seekPlayback } = setup({
        topicName,
        selected: true,
        pipelineData: {
          currentTime,
          // The iterator will yield a valid message, then one at the current time
          messages: [t1, currentTime],
        },
      });

      // When
      await act(async () => {
        await result.current.handlePreviousMessage();
      });

      // Then: It should find t1, then break the loop when it sees currentTime
      expect(pausePlayback).toHaveBeenCalled();
      expect(seekPlayback).toHaveBeenCalledWith(t1);
    });
  });

  describe("boundary discovery", () => {
    it("does not discover boundaries when not selected", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { getBatchIterator } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: t2,
          topicStats: new Map([[topicName, { numMessages: 2 }]]),
          messages: [t1, t2],
        },
      });

      // Then
      expect(getBatchIterator).not.toHaveBeenCalled();
    });

    it("discovers boundaries when selected", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { getBatchIterator } = setup({
        topicName,
        selected: true,
        pipelineData: {
          currentTime: t2,
          topicStats: new Map([[topicName, { numMessages: 2 }]]),
          messages: [t1, t2],
        },
      });

      // Then
      await waitFor(() => {
        expect(getBatchIterator).toHaveBeenCalledTimes(1);
      });
    });

    it("uses topicStats boundaries without reading any messages", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { result, getBatchIterator, getMessageAtTime } = setup({
        topicName,
        selected: true,
        pipelineData: {
          currentTime: t2,
          endTime: { sec: 10, nsec: 0 },
          topicStats: new Map([
            [topicName, { numMessages: 2, firstMessageTime: t1, lastMessageTime: t2 }],
          ]),
          messages: [t1, t2],
        },
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Then
      expect(result.current.canNavigateNext).toBe(false);
      expect(getBatchIterator).not.toHaveBeenCalled();
      expect(getMessageAtTime).not.toHaveBeenCalled();
    });

    it("reads only the first message and looks the last one up from the end time", async () => {
      // Given
      const messages: Time[] = Array.from({ length: 100 }, (_, i) => ({ sec: i + 1, nsec: 0 }));
      const endTime: Time = { sec: 200, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { result, consumption, getMessageAtTime } = setup({
        topicName,
        selected: true,
        pipelineData: {
          currentTime: { sec: 100, nsec: 0 },
          endTime,
          topicStats: new Map([[topicName, { numMessages: 100 }]]),
          messages,
          supportsMessageAtTime: true,
        },
      });

      // Then - at the last message, so "next" turns off once discovery finds it
      await waitFor(() => {
        expect(getMessageAtTime).toHaveBeenCalledWith(topicName, endTime, expect.any(AbortSignal));
      });
      await waitFor(() => {
        expect(result.current.canNavigateNext).toBe(false);
      });
      expect(consumption.yielded).toBe(1);
    });

    it("finds the last message with a window at the end when getMessageAtTime is unsupported", async () => {
      // Given
      const messages: Time[] = Array.from({ length: 100 }, (_, i) => ({ sec: i + 1, nsec: 0 }));
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { result, consumption } = setup({
        topicName,
        selected: true,
        pipelineData: {
          currentTime: { sec: 99, nsec: 0 },
          endTime: { sec: 100, nsec: 500_000_000 },
          topicStats: new Map([[topicName, { numMessages: 100 }]]),
          messages,
        },
      });

      // Then - 99 is before the last message (100), so "next" stays available
      await waitFor(() => {
        expect(consumption.yielded).toBe(2);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(result.current.canNavigateNext).toBe(true);
      expect(consumption.yielded).toBe(2);
    });

    it("does not discover boundaries when topic is not subscribed", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { getBatchIterator } = setup({
        topicName,
        selected: true,
        isTopicSubscribed: false,
        pipelineData: {
          currentTime: t2,
          topicStats: new Map([[topicName, { numMessages: 2 }]]),
          messages: [t1, t2],
        },
      });

      // Then
      expect(getBatchIterator).not.toHaveBeenCalled();
    });
  });

  describe("isNavigating state", () => {
    it("returns false when not actively navigating", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      // When
      const { result } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: t1,
          topicStats: new Map([[topicName, { numMessages: 1 }]]),
          messages: [],
        },
      });

      // Then
      expect(result.current.isNavigating).toBe(false);
    });
  });

  describe("error handling", () => {
    it("catches and logs error when iterator throws in handleNextMessage", async () => {
      // Given
      const topicName = `/${BasicBuilder.string()}`;

      const { result } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: RosTimeBuilder.time(),
          topicStats: new Map([[topicName, { numMessages: BasicBuilder.number() }]]),
          customIterator: createThrowingIterator(new Error("Iterator error"), topicName),
        },
      });

      // When
      await act(async () => {
        await result.current.handleNextMessage();
      });

      // Then - error should be caught, isNavigating should be reset to false
      expect(result.current.isNavigating).toBe(false);
    });

    it("catches and logs error when iterator throws in handlePreviousMessage", async () => {
      // Given
      const topicName = `/${BasicBuilder.string()}`;

      const { result } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: RosTimeBuilder.time(),
          topicStats: new Map([[topicName, { numMessages: BasicBuilder.number() }]]),
          customIterator: createThrowingIterator(new Error("Iterator error"), topicName),
        },
      });

      // When
      await act(async () => {
        await result.current.handlePreviousMessage();
      });

      // Then - error should be caught, isNavigating should be reset to false
      expect(result.current.isNavigating).toBe(false);
    });

    it("catches error when pausePlayback throws in handleNextMessage", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      const pausePlayback = vi.fn(() => {
        throw new Error("Pause playback error");
      });

      const { result } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: t1,
          topicStats: new Map([[topicName, { numMessages: BasicBuilder.number() }]]),
          messages: [t1, t2],
          pausePlayback,
        },
      });

      // When
      await act(async () => {
        await result.current.handleNextMessage();
      });

      // Then - error should be caught, isNavigating should be reset to false
      expect(result.current.isNavigating).toBe(false);
    });

    it("catches error when seekPlayback throws in handleNextMessage", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      const seekPlayback = vi.fn(() => {
        throw new Error("Seek playback error");
      });

      const { result } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: t1,
          topicStats: new Map([[topicName, { numMessages: BasicBuilder.number() }]]),
          messages: [t1, t2],
          seekPlayback,
        },
      });

      // When
      await act(async () => {
        await result.current.handleNextMessage();
      });

      // Then - error should be caught, isNavigating should be reset to false
      expect(result.current.isNavigating).toBe(false);
    });

    it("catches error when pausePlayback throws in handlePreviousMessage", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      const pausePlayback = vi.fn(() => {
        throw new Error("Pause playback error");
      });

      const { result } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: t2,
          topicStats: new Map([[topicName, { numMessages: BasicBuilder.number() }]]),
          messages: [t1, t2],
          pausePlayback,
        },
      });

      // When
      await act(async () => {
        await result.current.handlePreviousMessage();
      });

      // Then - error should be caught, isNavigating should be reset to false
      expect(result.current.isNavigating).toBe(false);
    });

    it("catches error when seekPlayback throws in handlePreviousMessage", async () => {
      // Given
      const t1: Time = { sec: 1, nsec: 0 };
      const t2: Time = { sec: 2, nsec: 0 };
      const topicName = `/${BasicBuilder.string()}`;

      const seekPlayback = vi.fn(() => {
        throw new Error("Seek playback error");
      });

      const { result } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: t2,
          topicStats: new Map([[topicName, { numMessages: BasicBuilder.number() }]]),
          messages: [t1, t2],
          seekPlayback,
        },
      });

      // When
      await act(async () => {
        await result.current.handlePreviousMessage();
      });

      // Then - error should be caught, isNavigating should be reset to false
      expect(result.current.isNavigating).toBe(false);
    });

    it("handles non-Error objects thrown by iterator", async () => {
      // Given
      const topicName = `/${BasicBuilder.string()}`;

      const { result } = setup({
        topicName,
        selected: false,
        pipelineData: {
          currentTime: RosTimeBuilder.time(),
          topicStats: new Map([[topicName, { numMessages: BasicBuilder.number() }]]),
          customIterator: createThrowingIterator("String error", topicName),
        },
      });

      // When
      await act(async () => {
        await result.current.handleNextMessage();
      });

      // Then - error should be caught even if it's not an Error instance
      expect(result.current.isNavigating).toBe(false);
    });
  });
});
