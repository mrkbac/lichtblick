/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook, act } from "@testing-library/react";
import type { Mock } from "vitest";

import { MessageEvent } from "@lichtblick/suite";
import { useMessagePipelineGetter } from "@lichtblick/suite-base/components/MessagePipeline";
import { useExtensionCatalog } from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import { BasicBuilder } from "@lichtblick/test-builders";

import { createMessageRangeIterator } from "./messageRangeIterator";
import { useSubscribeMessageRange } from "./useSubscribeMessageRange";

vi.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  useMessagePipelineGetter: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/context/ExtensionCatalogContext", () => ({
  useExtensionCatalog: vi.fn(),
}));

vi.mock("./messageRangeIterator", () => ({
  createMessageRangeIterator: vi.fn(),
}));

const mockUseMessagePipelineGetter = useMessagePipelineGetter as Mock;
const mockUseExtensionCatalog = useExtensionCatalog as Mock;
const mockCreateMessageRangeIterator = createMessageRangeIterator as Mock;

describe("useSubscribeMessageRange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseExtensionCatalog.mockReturnValue([]);
  });

  it("does not call onNewRangeIterator when batch iterator is unavailable", () => {
    // Given
    mockUseMessagePipelineGetter.mockReturnValue(
      vi.fn().mockReturnValue({
        sortedTopics: [],
        getBatchIterator: vi.fn().mockReturnValue(undefined),
      }),
    );
    const onNewRangeIterator = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSubscribeMessageRange());

    // When
    act(() => {
      result.current({ topic: BasicBuilder.string(), onNewRangeIterator });
    });

    // Then
    expect(onNewRangeIterator).not.toHaveBeenCalled();
  });

  it("returns a callable cancel function when batch iterator is unavailable", () => {
    // Given
    mockUseMessagePipelineGetter.mockReturnValue(
      vi.fn().mockReturnValue({
        sortedTopics: [],
        getBatchIterator: vi.fn().mockReturnValue(undefined),
      }),
    );
    const onNewRangeIterator = vi.fn().mockResolvedValue(async () => {});
    const { result } = renderHook(() => useSubscribeMessageRange());
    let cancel!: () => void;

    // When
    act(() => {
      cancel = result.current({ topic: BasicBuilder.string(), onNewRangeIterator });
    });

    // Then
    expect(() => {
      cancel();
    }).not.toThrow();
  });

  it("passes start/end and accepts Foxglove's deprecated onReset callback", () => {
    const mockIterable: AsyncIterable<MessageEvent[]> = { [Symbol.asyncIterator]: vi.fn() };
    mockCreateMessageRangeIterator.mockReturnValue({ iterable: mockIterable, cancel: vi.fn() });
    const mockGetBatchIterator = vi.fn().mockReturnValue({ [Symbol.asyncIterator]: vi.fn() });
    mockUseMessagePipelineGetter.mockReturnValue(
      vi.fn().mockReturnValue({ sortedTopics: [], getBatchIterator: mockGetBatchIterator }),
    );
    const onReset = vi.fn().mockResolvedValue(undefined);
    const start = { sec: 1, nsec: 0 };
    const end = { sec: 2, nsec: 0 };
    const { result } = renderHook(() => useSubscribeMessageRange());

    act(() => {
      result.current({
        topic: "/a",
        start,
        end,
        onReset,
      } as unknown as Parameters<typeof result.current>[0]);
    });

    expect(mockGetBatchIterator).toHaveBeenCalledWith("/a", { start, end });
    expect(onReset).toHaveBeenCalledWith(mockIterable);
  });

  it("calls onNewRangeIterator with the iterable when batch iterator is available", () => {
    // Given
    const topic = BasicBuilder.string();
    const mockIterable: AsyncIterable<MessageEvent[]> = { [Symbol.asyncIterator]: vi.fn() };
    const mockCancel = vi.fn();
    let cancel!: () => void;
    const mockBatchIterator = { [Symbol.asyncIterator]: vi.fn() };
    const onNewRangeIterator = vi.fn().mockResolvedValue(async () => {});
    mockCreateMessageRangeIterator.mockReturnValue({ iterable: mockIterable, cancel: mockCancel });
    const mockGetBatchIterator = vi.fn().mockReturnValue(mockBatchIterator);
    mockUseMessagePipelineGetter.mockReturnValue(
      vi.fn().mockReturnValue({ sortedTopics: [], getBatchIterator: mockGetBatchIterator }),
    );

    const { result } = renderHook(() => useSubscribeMessageRange());

    // When
    act(() => {
      cancel = result.current({ topic, onNewRangeIterator });
    });

    // Then
    expect(mockGetBatchIterator).toHaveBeenCalledWith(topic, { start: undefined, end: undefined });
    expect(onNewRangeIterator).toHaveBeenCalledWith(mockIterable);
    cancel();
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCreateMessageRangeIterator).toHaveBeenCalledWith(
      expect.objectContaining({
        topic,
        rawBatchIterator: mockBatchIterator,
        sortedTopics: [],
      }),
    );
  });
  it("cancels subscriptions still open when it unmounts", () => {
    // An extension that never calls cancel() must not keep reading after its panel is gone
    const cancel = vi.fn();
    mockCreateMessageRangeIterator.mockReturnValue({
      iterable: { [Symbol.asyncIterator]: vi.fn() },
      cancel,
    });
    mockUseMessagePipelineGetter.mockReturnValue(
      vi.fn().mockReturnValue({
        sortedTopics: [],
        getBatchIterator: vi.fn().mockReturnValue({ [Symbol.asyncIterator]: vi.fn() }),
      }),
    );
    const { result, unmount } = renderHook(() => useSubscribeMessageRange());
    const onNewRangeIterator = vi.fn().mockResolvedValue(undefined);
    act(() => {
      result.current({ topic: "/a", onNewRangeIterator });
      result.current({ topic: "/b", onNewRangeIterator })();
    });
    expect(cancel).toHaveBeenCalledTimes(1);

    unmount();

    expect(cancel).toHaveBeenCalledTimes(2);
  });
});
