/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// SPDX-FileCopyrightText: Copyright (C) 2025 Takayuki Honda <takayuki.honda@tier4.jp>
// SPDX-License-Identifier: MPL-2.0

import { render, screen } from "@testing-library/react";
import type { Mock } from "vitest";

import "@testing-library/jest-dom/vitest";

import { PanelExtensionContext } from "@lichtblick/suite";
import { useLegendCount } from "@lichtblick/suite-base/components/SettingsTreeEditor/inputs/useLegendCount";

import { PieChart, buildChartConfig, formatTooltip } from "./PieChart";
import { useSettingsTree } from "./useSettingsTree";

// Jest mock for hooks and context
vi.mock("@lichtblick/suite-base/components/SettingsTreeEditor/inputs/useLegendCount", () => ({
  useLegendCount: vi.fn(),
}));
vi.mock("./useSettingsTree", () => ({
  useSettingsTree: vi.fn(),
}));

const mockContext: Partial<PanelExtensionContext> = {
  saveState: vi.fn(),
  setDefaultPanelTitle: vi.fn(),
  updatePanelSettingsEditor: vi.fn(),
  subscribe: vi.fn(),
  unsubscribeAll: vi.fn(),
  onRender: vi.fn(),
  watch: vi.fn(),
};

describe("PieChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useLegendCount as Mock).mockReturnValue({ legendCount: 10 });
    (useSettingsTree as Mock).mockReturnValue({
      general: {
        fields: {
          path: { label: "Message path", input: "messagepath", value: "" },
          title: { label: "Title", input: "string", value: "Pie Chart" },
        },
      },
    });
  });

  it("renders the PieChart component with default configuration", () => {
    render(<PieChart context={mockContext as PanelExtensionContext} />);

    expect(screen.getByText("Pie Chart")).toBeInTheDocument();
    expect(screen.getByText("No data available")).toBeInTheDocument();
  });

  it("updates the settings editor on render", () => {
    render(<PieChart context={mockContext as PanelExtensionContext} />);

    expect(mockContext.updatePanelSettingsEditor).toHaveBeenCalledWith({
      actionHandler: expect.any(Function),
      nodes: expect.any(Object),
    });
  });

  it("formats tooltip correctly", () => {
    expect(formatTooltip(10, "Value")).toEqual(["10.00%", "Value"]);
    expect(formatTooltip("N/A", "Value")).toEqual(["N/A%", "Value"]);
  });

  it("maps chart data to a doughnut config", () => {
    // Given
    const data = [
      { name: "A", value: 25, color: "red" },
      { name: "B", value: 75, color: "blue" },
    ];

    // When
    const config = buildChartConfig(data, new Float32Array([1, 3]));

    // Then
    expect(config.type).toBe("doughnut");
    expect(config.data.labels).toEqual(["A", "B"]);
    expect(config.data.datasets[0]?.data).toEqual([25, 75]);
    expect(config.data.datasets[0]?.backgroundColor).toEqual(["red", "blue"]);
    expect(config.options?.plugins?.legend?.position).toBe("bottom");

    const tooltipLabel = config.options?.plugins?.tooltip?.callbacks?.label as unknown as (item: {
      raw: number;
      label: string;
    }) => string;
    expect(tooltipLabel({ raw: 25, label: "A" })).toBe("A: 25.00%");

    const datalabels = config.options?.plugins?.datalabels;
    const formatter = datalabels?.formatter as (
      value: number,
      ctx: { dataIndex: number },
    ) => string;
    const color = datalabels?.color as (ctx: { dataIndex: number }) => string;
    expect(formatter(75, { dataIndex: 1 })).toBe("3.00");
    expect(color({ dataIndex: 1 })).toBe("blue");
  });
});
