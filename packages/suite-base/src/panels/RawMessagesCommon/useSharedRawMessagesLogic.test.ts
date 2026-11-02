/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Time } from "@foxglove/rostime";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

import type { SharedConfig, UseSharedRawMessagesLogicProps } from "./types";
import { useSharedRawMessagesLogic } from "./useSharedRawMessagesLogic";

const TOPIC = "/some/topic";
const at = (sec: number): Time => ({ sec, nsec: 0 });
const messageAt = (time: Time) => ({ topic: TOPIC, receiveTime: time, message: {} });

let mockTopics: { name: string; schemaName: string }[] = [];
let mockMatches: { messageEvent: ReturnType<typeof messageAt>; queriedData: unknown[] }[] = [];
const mockPipeline = {
  playerState: { activeData: { currentTime: at(5) as Time | undefined, topicStats: new Map() } },
  seekPlayback: vi.fn() as Mock | undefined,
  pausePlayback: vi.fn(),
  getBatchIterator: vi.fn(),
  getMessageAtTime: vi.fn(),
};

// Minimal mocks for deps the hook uses
vi.mock("@lichtblick/suite-base/PanelAPI", () => ({
  useDataSourceInfo: () => ({ topics: mockTopics, datatypes: new Map() }),
}));
vi.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  useMessagePipeline: (selector: (ctx: typeof mockPipeline) => unknown) => selector(mockPipeline),
}));
vi.mock(
  "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems",
  () => {
    const getItems = () => [{ value: {}, path: "" }];
    return { useCachedGetMessagePathDataItems: () => getItems };
  },
);
vi.mock("@lichtblick/suite-base/components/PanelContext", () => ({
  usePanelContext: () => ({ setMessagePathDropConfig: vi.fn() }),
}));
vi.mock("@lichtblick/suite-base/components/MessagePathSyntax/useMessageDataItem", () => ({
  useMessageDataItem: () => mockMatches,
}));

const setup = (inputOverride?: {
  config?: Partial<SharedConfig>;
  saveConfig?: UseSharedRawMessagesLogicProps<SharedConfig>["saveConfig"];
}) => {
  const defaultConfig: SharedConfig = {
    topicPath: "some/topic",
    diffMethod: "custom",
    diffTopicPath: "some/diff/topic",
    diffEnabled: false,
  };

  const input: UseSharedRawMessagesLogicProps<SharedConfig> = {
    config: {
      ...defaultConfig,
      ...inputOverride?.config,
    },
    saveConfig: inputOverride?.saveConfig ?? vi.fn(),
  };

  return {
    ...renderHook(() => useSharedRawMessagesLogic(input)),
    input,
    saveConfig: input.saveConfig as Mock,
  };
};
describe("given useSharedRawMessagesLogic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTopics = [];
    mockMatches = [];
    mockPipeline.seekPlayback = vi.fn();
    mockPipeline.playerState.activeData.currentTime = at(5);
  });
  describe("when toggling diff", () => {
    it("then enables diff when currently disabled", () => {
      const { result, saveConfig } = setup();

      act(() => {
        result.current.onToggleDiff();
      });

      expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ diffEnabled: true }));
    });

    it("then disables diff when currently enabled", () => {
      const { result, saveConfig } = setup({
        config: {
          diffEnabled: true,
        },
      });

      act(() => {
        result.current.onToggleDiff();
      });

      expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ diffEnabled: false }));
    });
  });
  describe("when toggling expand-all", () => {
    it("then expands all when starting from 'none'", () => {
      const { result, saveConfig } = setup({
        config: {
          expansion: "none",
        },
      });

      expect(result.current.canExpandAll).toBe(true);

      act(() => {
        result.current.onToggleExpandAll();
      });

      expect(result.current.expansion).toBe("all");
      expect(result.current.canExpandAll).toBe(false);
      expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ expansion: "all" }));
    });
    it("then collapses all when starting from 'all'", () => {
      const { result, saveConfig } = setup({
        config: {
          expansion: "all",
        },
      });

      expect(result.current.canExpandAll).toBe(false);

      act(() => {
        result.current.onToggleExpandAll();
      });

      expect(result.current.expansion).toBe("none");
      expect(result.current.canExpandAll).toBe(true);
      expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ expansion: "none" }));
    });
  });

  describe("when topic path changes and expansion is 'all'", () => {
    it("then resets expansion to 'none'", () => {
      const { result, saveConfig } = setup({
        config: {
          expansion: "all",
        },
      });

      act(() => {
        result.current.onTopicPathChange("/new/topic");
      });

      expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ topicPath: "/new/topic" }));
      expect(result.current.expansion).toBe("none");
    });
  });
  describe("when label is clicked", () => {
    it("then toggles expansion", () => {
      const { result, saveConfig } = setup({
        config: {
          expansion: "none",
        },
      });

      act(() => {
        result.current.onToggleExpand("field1", {});
      });

      // After clicking a label, expansion should become an object state
      expect(typeof result.current.expansion).toBe("object");

      // The hook persists expansion via saveConfig
      expect(saveConfig).toHaveBeenCalledWith({
        expansion: expect.any(Object),
      });
    });
  });

  describe("when stepping through messages", () => {
    beforeEach(() => {
      mockTopics = [{ name: TOPIC, schemaName: "Schema" }];
      // Playhead sits between messages; the displayed message is at 4s.
      mockMatches = [{ messageEvent: messageAt(at(4)), queriedData: [{ value: {} }] }];
    });

    it("then steps back from the displayed message, not the playhead", async () => {
      mockPipeline.getMessageAtTime.mockResolvedValue(messageAt(at(3)));
      const { result } = setup({ config: { topicPath: TOPIC } });

      act(() => {
        result.current.onStepPrevious();
      });

      await waitFor(() => {
        expect(mockPipeline.seekPlayback).toHaveBeenCalledWith(at(3));
      });
      expect(mockPipeline.getMessageAtTime).toHaveBeenCalledWith(TOPIC, {
        sec: 3,
        nsec: 999_999_999,
      });
      expect(mockPipeline.pausePlayback).toHaveBeenCalled();
    });

    it("then steps forward to the first message after the playhead", async () => {
      mockPipeline.getBatchIterator.mockImplementation(async function* () {
        yield { type: "message-event", msgEvent: messageAt(at(5)) };
        yield { type: "message-event", msgEvent: messageAt(at(6)) };
      });
      const { result } = setup({ config: { topicPath: TOPIC } });

      act(() => {
        result.current.onStepNext();
      });

      await waitFor(() => {
        expect(mockPipeline.seekPlayback).toHaveBeenCalledWith(at(6));
      });
    });

    it("then disables stepping for sources that cannot seek", () => {
      mockPipeline.seekPlayback = undefined;
      const { result } = setup({ config: { topicPath: TOPIC } });

      expect(result.current.canStep).toBe(false);
      expect(result.current.canStepPrevious).toBe(false);
      expect(result.current.canStepNext).toBe(false);
    });
  });

  describe("when diffing against the previous message after a seek", () => {
    it("then reads the previous message from the source", async () => {
      mockTopics = [{ name: TOPIC, schemaName: "Schema" }];
      mockMatches = [{ messageEvent: messageAt(at(4)), queriedData: [{ value: {} }] }];
      mockPipeline.getMessageAtTime.mockResolvedValue(messageAt(at(3)));

      const { result } = setup({
        config: { topicPath: TOPIC, diffEnabled: true, diffMethod: "previous message" },
      });

      await waitFor(() => {
        expect(result.current.baseItem?.messageEvent.receiveTime).toEqual(at(3));
      });
      expect(result.current.diffItem?.messageEvent.receiveTime).toEqual(at(4));
    });
  });
});
