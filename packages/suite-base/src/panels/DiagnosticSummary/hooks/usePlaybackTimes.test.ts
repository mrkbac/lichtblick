/** @jest-environment jsdom */
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";
import { act, renderHook } from "@testing-library/react";
import type { Mock } from "vitest";

import {
  useMessagePipeline,
  useMessagePipelineGetter,
  useMessagePipelineSubscribe,
} from "@lichtblick/suite-base/components/MessagePipeline";

import usePlaybackTimes from "./usePlaybackTimes";

vi.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  useMessagePipelineGetter: vi.fn(),
  useMessagePipeline: vi.fn(),
  useMessagePipelineSubscribe: vi.fn(),
}));

describe("usePlaybackTimes", () => {
  const start: Time = { sec: 1, nsec: 0 };
  const end: Time = { sec: 100, nsec: 0 };
  let current: Time | undefined;
  let listeners: (() => void)[];
  /** The pipeline publishes a frame */
  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    current = { sec: 10, nsec: 0 };
    (useMessagePipelineGetter as Mock).mockReturnValue(() => ({
      playerState: { activeData: { startTime: start, endTime: end, currentTime: current } },
    }));
    (useMessagePipeline as Mock).mockReturnValue(undefined);
    listeners = [];
    const subscribe = (fn: () => void) => {
      listeners.push(fn);
      return () => {
        listeners = listeners.filter((other) => other !== fn);
      };
    };
    (useMessagePipelineSubscribe as Mock).mockReturnValue(subscribe);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns start, end and current time", () => {
    const { result } = renderHook(() => usePlaybackTimes());
    expect(result.current).toEqual({ start, end, current });
  });

  it("reads the current time at most once per interval and keeps identity while nothing changes", () => {
    const { result } = renderHook(() => usePlaybackTimes(100));
    const first = result.current;

    act(() => {
      current = { sec: 10, nsec: 0 }; // equal value, new object
      emit();
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe(first);

    act(() => {
      current = { sec: 11, nsec: 0 };
      emit();
      vi.advanceTimersByTime(50);
      current = { sec: 12, nsec: 0 };
      emit();
    });
    expect(result.current.current).toEqual({ sec: 10, nsec: 0 });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.current).toEqual({ sec: 12, nsec: 0 });
  });

  it("schedules nothing while the pipeline publishes nothing (paused)", () => {
    const { unmount } = renderHook(() => usePlaybackTimes(100));
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      emit();
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(listeners).toHaveLength(0);
  });

  it("handles a player without active data", () => {
    (useMessagePipelineGetter as Mock).mockReturnValue(() => ({ playerState: {} }));
    const { result } = renderHook(() => usePlaybackTimes());
    expect(result.current).toEqual({ start: undefined, end: undefined, current: undefined });
  });
});
