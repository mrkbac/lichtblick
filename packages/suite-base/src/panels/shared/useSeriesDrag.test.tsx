/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";

import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import MockPanelContextProvider from "@lichtblick/suite-base/components/MockPanelContextProvider";
import { useMessagePathDrag } from "@lichtblick/suite-base/services/messagePathDragging";

import { useSeriesDrag } from "./useSeriesDrag";

vi.mock("@lichtblick/suite-base/services/messagePathDragging", () => ({
  useMessagePathDrag: vi.fn(() => ({
    dragRef: vi.fn(),
    isDragging: false,
    draggedItemCount: 0,
  })),
}));

function render(pathValue: string | undefined) {
  return renderHook(() => useSeriesDrag(pathValue), {
    wrapper: ({ children }) => (
      <MockMessagePipelineProvider topics={[{ name: "/odom", schemaName: "nav/Odometry" }]}>
        <MockPanelContextProvider id="plot-a">{children}</MockPanelContextProvider>
      </MockMessagePipelineProvider>
    ),
  });
}

describe("useSeriesDrag", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("drags the series as a leaf path tagged with its source panel", () => {
    const { result } = render("/odom.twist.linear.x");

    expect(result.current.dragRef).toBeDefined();
    expect(useMessagePathDrag).toHaveBeenLastCalledWith({
      item: {
        path: "/odom.twist.linear.x",
        rootSchemaName: "nav/Odometry",
        isTopic: false,
        isLeaf: true,
        topicName: "/odom",
      },
      selected: false,
      sourcePanelId: "plot-a",
    });
  });

  it.each([undefined, "", "1.5"])("is not draggable for %j", (value) => {
    expect(render(value).result.current.dragRef).toBeUndefined();
  });
});
