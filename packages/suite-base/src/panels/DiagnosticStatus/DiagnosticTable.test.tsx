/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

import { DiagnosticInfo } from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import { LEVELS } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";
import DiagnosticsBuilder from "@lichtblick/suite-base/testing/builders/DiagnosticsBuilder";
import { BasicBuilder } from "@lichtblick/test-builders";

import DiagnosticTable, { DiagnosticTableProps, formatValue } from "./DiagnosticTable";

// Render every row; jsdom has no layout for the virtualizer to measure.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({
    count,
    getItemKey,
  }: {
    count: number;
    getItemKey: (index: number) => string;
  }) => ({
    getTotalSize: () => count * 26,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: getItemKey(index), start: 0 })),
    measureElement: () => {},
  }),
}));

function renderTable(props: DiagnosticTableProps) {
  const ui = (p: DiagnosticTableProps) => (
    <PanelSetup>
      <DiagnosticTable {...p} />
    </PanelSetup>
  );
  const result = render(ui(props));
  return {
    rerender: (p: DiagnosticTableProps) => {
      result.rerender(ui(p));
    },
  };
}

describe("DiagnosticTable", () => {
  const mockOnChangeSplitFraction = vi.fn();
  const mockOpenSiblingPanel = vi.fn();

  function props(infos: DiagnosticInfo[]): DiagnosticTableProps {
    return {
      infos,
      history: new Map(),
      range: undefined,
      staleSec: 5,
      numericPrecision: undefined,
      onChangeSplitFraction: mockOnChangeSplitFraction,
      openSiblingPanel: mockOpenSiblingPanel,
      splitFraction: 0.5,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders display name, message and key-values of every status", () => {
    const infos = [DiagnosticsBuilder.info(), DiagnosticsBuilder.info()];
    renderTable(props(infos));

    for (const info of infos) {
      expect(screen.getByText(info.displayName)).toBeInTheDocument();
      expect(screen.getByText(info.status.message)).toBeInTheDocument();
      for (const { key, value } of info.status.values) {
        expect(screen.getByText(key)).toBeInTheDocument();
        expect(screen.getByText(value)).toBeInTheDocument();
      }
    }
  });

  it("triggers onChangeSplitFraction while dragging the resize handle", () => {
    renderTable(props([DiagnosticsBuilder.info()]));

    fireEvent.mouseDown(screen.getByTestId("DiagnosticTable-resizeHandle"));
    fireEvent.mouseMove(window, { clientX: 100 });
    fireEvent.mouseUp(window);

    expect(mockOnChangeSplitFraction).toHaveBeenCalled();
  });

  it("opens Plot for numbers and State Transitions for text, using the status' topic", () => {
    const status = DiagnosticsBuilder.statusMessage({
      values: [
        DiagnosticsBuilder.keyValue({ value: "text" }),
        DiagnosticsBuilder.keyValue({ key: "num", value: "1.5" }),
      ],
    });
    const info = DiagnosticsBuilder.info({ status, topic: "/agg" });
    renderTable(props([info]));

    fireEvent.click(screen.getByTestId("open-plot-button"));
    const plotConfig = mockOpenSiblingPanel.mock.calls[0][0].siblingConfigCreator({ paths: [] });
    expect(JSON.stringify(plotConfig)).toContain(`/agg.status[:]{hardware_id==`);
    expect(JSON.stringify(plotConfig)).toContain(`{key==\\"num\\"}.value`);

    fireEvent.click(screen.getByTestId("open-state-transitions-button"));
    expect(mockOpenSiblingPanel).toHaveBeenCalledTimes(2);
  });

  it("highlights values that changed since the previous message", () => {
    const key = BasicBuilder.string();
    const status = DiagnosticsBuilder.statusMessage({
      level: LEVELS.OK,
      values: [{ key, value: "1" }, DiagnosticsBuilder.keyValue({ value: "same" })],
    });
    const info = DiagnosticsBuilder.info({ status });
    const { rerender } = renderTable(props([info]));
    expect(screen.queryByTestId("diagnostic-value-changed")).not.toBeInTheDocument();

    const next = {
      ...info,
      status: { ...status, values: [{ key, value: "2" }, status.values[1]!] },
    };
    rerender(props([next]));

    const changed = screen.getAllByTestId("diagnostic-value-changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]).toHaveTextContent("2");
    expect(changed[0]).toHaveAttribute("title", "Previous: 1");
  });

  it("offers copy buttons for values and the whole status", () => {
    renderTable(props([DiagnosticsBuilder.info()]));
    expect(screen.getByLabelText("Copy status as JSON")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Copy value")).toHaveLength(3);
  });
});

describe("formatValue", () => {
  it("applies numeric precision only to numbers", () => {
    expect(formatValue("1.23456", 2)).toBe("1.23");
    expect(formatValue("abc", 2)).toBe("abc");
    expect(formatValue("1.23456", undefined)).toBe("1.23456");
  });
});
