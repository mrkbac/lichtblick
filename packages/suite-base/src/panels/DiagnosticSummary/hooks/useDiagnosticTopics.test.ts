/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";

import { renderHook } from "@testing-library/react";

import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";

import {
  DiagnosticTopicsConfig,
  getConfiguredTopics,
  handleTopicToggle,
  useDiagnosticTopics,
} from "./useDiagnosticTopics";

vi.mock("@lichtblick/suite-base/PanelAPI", () => ({ useDataSourceInfo: vi.fn() }));

const dataSourceTopics = [
  { name: "/diagnostics", schemaName: "diagnostic_msgs/msg/DiagnosticArray" },
  { name: "/robot/diagnostics_agg", schemaName: "diagnostic_msgs/DiagnosticArray" },
  { name: "/diagnostics", schemaName: "diagnostic_msgs/msg/DiagnosticArray" },
  { name: "/camera", schemaName: "sensor_msgs/msg/Image" },
];

describe("getConfiguredTopics", () => {
  it("prefers topics, migrates topicToRender, and defaults to all", () => {
    expect(getConfiguredTopics({ topics: ["/a"], topicToRender: "/b" })).toEqual(["/a"]);
    expect(getConfiguredTopics({ topicToRender: "/b" })).toEqual(["/b"]);
    expect(getConfiguredTopics({})).toBeUndefined();
  });
});

describe("useDiagnosticTopics", () => {
  beforeEach(() => {
    (useDataSourceInfo as Mock).mockReturnValue({ topics: dataSourceTopics });
  });

  it("auto-detects all DiagnosticArray topics by schema", () => {
    const { result } = renderHook(() => useDiagnosticTopics({}));
    expect(result.current.available).toEqual(["/diagnostics", "/robot/diagnostics_agg"]);
    expect(result.current.subscribed).toEqual(["/diagnostics", "/robot/diagnostics_agg"]);
  });

  it("subscribes only to selected topics that exist", () => {
    const { result } = renderHook(() =>
      useDiagnosticTopics({ topics: ["/robot/diagnostics_agg", "/gone"] }),
    );
    expect(result.current.selected).toEqual(["/robot/diagnostics_agg", "/gone"]);
    expect(result.current.subscribed).toEqual(["/robot/diagnostics_agg"]);
  });

  it("keeps a stable identity across renders with equal input", () => {
    const { result, rerender } = renderHook(
      (config: DiagnosticTopicsConfig) => useDiagnosticTopics(config),
      { initialProps: { topics: ["/diagnostics"] } },
    );
    const first = result.current;
    rerender({ topics: ["/diagnostics"] });
    expect(result.current).toBe(first);
  });

  it("supports an empty selection", () => {
    const { result } = renderHook(() => useDiagnosticTopics({ topics: [] }));
    expect(result.current.subscribed).toEqual([]);
  });
});

describe("handleTopicToggle", () => {
  const topics = { available: ["/a", "/b"], selected: ["/a", "/b"], subscribed: ["/a", "/b"] };

  it("removes and adds topics and clears the legacy field", () => {
    expect(handleTopicToggle(["topics", "/a", "visible"], false, topics)).toEqual({
      topics: ["/b"],
      topicToRender: undefined,
    });
    expect(
      handleTopicToggle(["topics", "/c", "visible"], true, { ...topics, selected: ["/a"] }),
    ).toEqual({ topics: ["/a", "/c"], topicToRender: undefined });
  });

  it("ignores other paths", () => {
    expect(handleTopicToggle(["general", "sortByLevel"], true, topics)).toBeUndefined();
  });
});
