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

import { PieChart, formatTooltip } from "./PieChart";
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
    (useLegendCount as unknown as Mock).mockReturnValue({ legendCount: 10 });
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
});
