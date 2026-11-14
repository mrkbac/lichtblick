/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import type { Mock } from "vitest";

import { MessagePathDataItem } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import {
  PathSample,
  toPathSample,
  usePathSampleHistory,
} from "@lichtblick/suite-base/components/MessagePathSyntax/usePathSampleHistory";
import { LIVE_HISTORY_SIZE } from "@lichtblick/suite-base/panels/StateTransitions/constants";
import { SamplesByPath } from "@lichtblick/suite-base/panels/StateTransitions/types";
import { MessageEvent } from "@lichtblick/suite-base/players/types";
import MessageEventBuilder from "@lichtblick/suite-base/testing/builders/MessageEventBuilder";
import { BasicBuilder } from "@lichtblick/test-builders";

import { useDecodedMessageRange } from "./hooks/useDecodedMessageRange";
import StateTransitionsPanelWithHoc from "./index";
import { StateTransitionConfig } from "./types";

const sample = ({
  messageEvent,
  queriedData,
}: {
  messageEvent: MessageEvent;
  queriedData: MessagePathDataItem[];
}): PathSample => toPathSample(messageEvent, queriedData);

// The Panel HOC is mocked to return the inner component, which takes config and saveConfig directly
const StateTransitionsPanel = StateTransitionsPanelWithHoc as unknown as React.ComponentType<{
  config: StateTransitionConfig;
  saveConfig: (config: Partial<StateTransitionConfig>) => void;
}>;

vi.mock("@lichtblick/suite-base/components/Panel", () => ({
  __esModule: true,
  default: (Component: React.ComponentType) =>
    Object.assign(Component, { panelType: "StateTransitions", defaultConfig: {} }),
}));

vi.mock(
  "@lichtblick/suite-base/components/MessagePathSyntax/usePathSampleHistory",
  async (importOriginal) => ({
    ...(await importOriginal()),
    usePathSampleHistory: vi.fn(),
  }),
);
vi.mock("@lichtblick/suite-base/panels/StateTransitions/hooks/useDecodedMessageRange");
let mockCurrentTime = 0;
vi.mock("@lichtblick/suite-base/panels/StateTransitions/hooks/useStateTransitionsTime", () => ({
  __esModule: true,
  default: () => ({
    startTime: { sec: 0, nsec: 0 },
    currentTimeSinceStart: mockCurrentTime,
    endTimeSinceStart: 10,
  }),
}));
vi.mock("@lichtblick/suite-base/panels/StateTransitions/hooks/useStateTransitionsData", () => ({
  __esModule: true,
  // One point at x=1 so the mocked chart's click (below) lands on real data.
  default: () => ({
    pathState: [],
    data: { datasets: [{ data: [{ x: 1, y: 0, value: "A" }] }] },
    minY: 0,
    matchStarts: [1, 5],
  }),
}));
vi.mock("@lichtblick/suite-base/panels/StateTransitions/hooks/useChartScalesAndBounds", () => ({
  __esModule: true,
  default: () => ({
    yScale: {},
    xScale: {},
    databounds: { x: { min: 0, max: 10 }, y: { min: 0, max: 1 } },
    width: 800,
    sizeRef: { current: undefined },
  }),
}));
vi.mock("@lichtblick/suite-base/panels/StateTransitions/hooks/useMessagePathDropConfig");
vi.mock("@lichtblick/suite-base/panels/StateTransitions/hooks/usePanelSettings");
const mockSeekPlayback = vi.fn();
vi.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  useMessagePipeline: (selector: (ctx: unknown) => unknown) =>
    selector({ playerState: { presence: "PRESENT" } }),
  useMessagePipelineGetter: () => () => ({
    seekPlayback: mockSeekPlayback,
    playerState: { activeData: { startTime: { sec: 0, nsec: 0 } } },
  }),
}));
vi.mock("@lichtblick/suite-base/components/PanelToolbar", () => ({
  __esModule: true,
  default: ({ additionalIcons }: { additionalIcons: React.ReactNode }) => (
    <div data-testid="panel-toolbar">{additionalIcons}</div>
  ),
}));
vi.mock("@lichtblick/suite-base/components/TimeBasedChart", () => ({
  __esModule: true,
  default: ({
    annotations,
    onClick,
  }: {
    annotations: unknown[];
    onClick: (arg: unknown) => void;
  }) => (
    <button
      data-testid="time-based-chart"
      data-annotation-count={annotations.length}
      onClick={() => {
        onClick({ x: 1, y: 0 });
      }}
    />
  ),
}));
vi.mock("@lichtblick/suite-base/panels/StateTransitions/PathLegend", () => ({
  PathLegend: () => <div data-testid="path-legend" />,
}));
vi.mock("@lichtblick/suite-base/panels/StateTransitions/StateTransitions.style", () => ({
  useStateTransitionsStyles: () => ({ classes: { chartWrapper: "chartWrapper" } }),
}));

const mockUsePathSampleHistory = usePathSampleHistory as Mock;
const mockUseDecodedMessageRange = useDecodedMessageRange as Mock;

function buildMessageAndData(path: string) {
  const topic = path.split(".")[0]!;
  return sample({
    messageEvent: MessageEventBuilder.messageEvent({ topic }),
    queriedData: [{ path, value: BasicBuilder.string() }],
  });
}

describe("StateTransitions", () => {
  const defaultConfig: StateTransitionConfig = {
    paths: [],
    isSynced: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentTime = 0;
    mockUseDecodedMessageRange.mockReturnValue([{}]);
    mockUsePathSampleHistory.mockReturnValue({});
  });

  function renderPanel(config: Partial<StateTransitionConfig> = {}) {
    const saveConfig = vi.fn();
    return {
      ...render(
        <StateTransitionsPanel config={{ ...defaultConfig, ...config }} saveConfig={saveConfig} />,
      ),
    };
  }

  it("should render the panel", () => {
    const { getByTestId } = renderPanel();
    expect(getByTestId("time-based-chart")).toBeDefined();
    expect(getByTestId("path-legend")).toBeDefined();
  });

  it("should pass pathStrings to usePathSampleHistory when no range data", () => {
    mockUseDecodedMessageRange.mockReturnValue([{}]);
    const topicA = BasicBuilder.string();
    const topicB = BasicBuilder.string();

    renderPanel({
      paths: [
        { value: topicA, timestampMethod: "receiveTime" },
        { value: topicB, timestampMethod: "receiveTime" },
      ],
    });

    expect(mockUsePathSampleHistory).toHaveBeenCalledWith([topicA, topicB], LIVE_HISTORY_SIZE);
  });

  it("should remove marker annotations when a path timestamp source changes", () => {
    // Given
    const topic = BasicBuilder.string();
    const { rerender } = renderPanel({
      paths: [{ value: topic, timestampMethod: "receiveTime" }],
    });
    fireEvent.click(screen.getByTestId("state-transitions-measure-mode-toggle"));
    fireEvent.click(screen.getByTestId("time-based-chart"));
    expect(screen.getByTestId("time-based-chart")).toHaveAttribute("data-annotation-count", "1");

    // When
    rerender(
      <StateTransitionsPanel
        config={{
          ...defaultConfig,
          paths: [{ value: topic, timestampMethod: "headerStamp" }],
        }}
        saveConfig={vi.fn()}
      />,
    );

    // Then
    expect(screen.getByTestId("time-based-chart")).toHaveAttribute("data-annotation-count", "0");
  });

  it("should pass empty array to usePathSampleHistory when range data is active", () => {
    const topic = BasicBuilder.string();
    const decodedMessages: SamplesByPath[] = [{ [topic]: [buildMessageAndData(topic)] }];
    mockUseDecodedMessageRange.mockReturnValue(decodedMessages);

    renderPanel({
      paths: [{ value: topic, timestampMethod: "receiveTime" }],
    });

    expect(mockUsePathSampleHistory).toHaveBeenCalledWith([], LIVE_HISTORY_SIZE);
  });

  it("should pass pathStrings when decodedMessages has matching paths but empty arrays", () => {
    const topic = BasicBuilder.string();
    const decodedMessages: SamplesByPath[] = [{ [topic]: [] }];
    mockUseDecodedMessageRange.mockReturnValue(decodedMessages);

    renderPanel({
      paths: [{ value: topic, timestampMethod: "receiveTime" }],
    });

    expect(mockUsePathSampleHistory).toHaveBeenCalledWith([topic], LIVE_HISTORY_SIZE);
  });

  it("should skip usePathSampleHistory when any path has range data", () => {
    const topicA = BasicBuilder.string();
    const topicB = BasicBuilder.string();
    const decodedMessages: SamplesByPath[] = [
      {
        [topicA]: [buildMessageAndData(topicA)],
        [topicB]: [],
      },
    ];
    mockUseDecodedMessageRange.mockReturnValue(decodedMessages);

    renderPanel({
      paths: [
        { value: topicA, timestampMethod: "receiveTime" },
        { value: topicB, timestampMethod: "receiveTime" },
      ],
    });

    expect(mockUsePathSampleHistory).toHaveBeenCalledWith([], LIVE_HISTORY_SIZE);
  });

  it.each([undefined, "=> 2"])("hides match navigation for condition %s", (condition) => {
    renderPanel({ paths: [{ value: "/a.b", condition, timestampMethod: "receiveTime" }] });
    expect(screen.queryByTestId("state-transitions-match-count")).toBeNull();
  });

  it("shows the match count and seeks between matches with buttons and N / Shift+N", () => {
    renderPanel({
      paths: [{ value: "/a.b", condition: "> 2", timestampMethod: "receiveTime" }],
    });

    expect(screen.getByTestId("state-transitions-match-count")).toHaveTextContent("0/2");
    expect(screen.getByTestId("state-transitions-previous-match")).toBeDisabled();

    fireEvent.click(screen.getByTestId("state-transitions-next-match"));
    expect(mockSeekPlayback).toHaveBeenLastCalledWith({ sec: 1, nsec: 0 });

    fireEvent.keyDown(document, { key: "n" });
    expect(mockSeekPlayback).toHaveBeenCalledTimes(2);
    expect(mockSeekPlayback).toHaveBeenLastCalledWith({ sec: 1, nsec: 0 });

    // Nothing before the playhead (t=0), so Shift+N does not seek.
    fireEvent.keyDown(document, { key: "N", shiftKey: true });
    expect(mockSeekPlayback).toHaveBeenCalledTimes(2);
  });

  it.each([
    [1, "1/2", true, false],
    [3, "1/2", false, false],
    [5, "2/2", false, true],
  ])("at t=%s shows %s with previous/next disabled = %s/%s", (time, count, noPrev, noNext) => {
    mockCurrentTime = time;
    renderPanel({ paths: [{ value: "/a.b", condition: "> 2", timestampMethod: "receiveTime" }] });

    expect(screen.getByTestId("state-transitions-match-count")).toHaveTextContent(count);
    expect(screen.getByTestId("state-transitions-previous-match").hasAttribute("disabled")).toBe(
      noPrev,
    );
    expect(screen.getByTestId("state-transitions-next-match").hasAttribute("disabled")).toBe(
      noNext,
    );
  });
});
