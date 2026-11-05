/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";
import { act, renderHook } from "@testing-library/react";
import type { Mock } from "vitest";

import {
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";

import usePlaybackTimes from "./usePlaybackTimes";

vi.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  useMessagePipelineGetter: vi.fn(),
  useMessagePipeline: vi.fn(),
}));

describe("usePlaybackTimes", () => {
  const start: Time = { sec: 1, nsec: 0 };
  const end: Time = { sec: 100, nsec: 0 };
  let current: Time | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    current = { sec: 10, nsec: 0 };
    (useMessagePipelineGetter as Mock).mockReturnValue(() => ({
      playerState: { activeData: { startTime: start, endTime: end, currentTime: current } },
    }));
    (useMessagePipeline as Mock).mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns start, end and current time", () => {
    const { result } = renderHook(() => usePlaybackTimes());
    expect(result.current).toEqual({ start, end, current });
  });

  it("polls the current time and keeps identity while nothing changes", () => {
    const { result } = renderHook(() => usePlaybackTimes(100));
    const first = result.current;

    act(() => {
      current = { sec: 10, nsec: 0 }; // equal value, new object
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe(first);

    act(() => {
      current = { sec: 11, nsec: 0 };
      vi.advanceTimersByTime(100);
    });
    expect(result.current.current).toEqual({ sec: 11, nsec: 0 });
  });

  it("handles a player without active data", () => {
    (useMessagePipelineGetter as Mock).mockReturnValue(() => ({ playerState: {} }));
    const { result } = renderHook(() => usePlaybackTimes());
    expect(result.current).toEqual({ start: undefined, end: undefined, current: undefined });
  });
});
