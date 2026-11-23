/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render, screen } from "@testing-library/react";

import PanelContext from "@lichtblick/suite-base/components/PanelContext";

import { PlotLegendRow, formatLegendNumber } from "./PlotLegendRow";

vi.mock("@lichtblick/suite-base/panels/shared/useSeriesDrag", () => ({
  useSeriesDrag: () => ({ dragRef: undefined, isDragging: false }),
}));
vi.mock("@lichtblick/hooks", () => ({
  useGuaranteedContext: vi.fn(() => ({ setState: vi.fn(), state: {} })),
}));
vi.mock("@lichtblick/suite-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutActions: vi.fn(() => ({ getCurrentLayoutState: vi.fn() })),
  useSelectedPanels: vi.fn(() => ({ setSelectedPanelIds: vi.fn() })),
}));

describe("formatLegendNumber", () => {
  it.each([
    // Counters and seconds timestamps must stay exact, not 1.235e+5 / 1.700e+9
    [123456, "123456"],
    [1700000000, "1700000000"],
    [-42, "-42"],
    [0, "0"],
    [0.5, "0.5000"],
    [1700000000.25, "1700000000.2500"],
    [-99999.5, "-99999.5000"],
    [0.00001234, "1.234e-5"],
    [1.5e20, "150000000000000000000"],
    // Representable fractions past 1e15 use the exponent
    [2e15 + 0.5, "2.000e+15"],
    [Number.NaN, "NaN"],
  ])("formats %d as %s", (value, expected) => {
    expect(formatLegendNumber(value)).toBe(expected);
  });
});

describe("PlotLegendRow", () => {
  const renderRow = (value: unknown) => {
    const path = { value: "/a.b", enabled: true, timestampMethod: "receiveTime" as const };
    render(
      <PanelContext.Provider value={{ id: "Plot!1", type: "Plot" } as never}>
        <PlotLegendRow
          hasMismatchedDataLength={false}
          index={0}
          onClickPath={vi.fn()}
          path={path}
          paths={[path]}
          value={value}
          valueSource="current"
          savePaths={vi.fn()}
          editing={false}
          onStartEdit={vi.fn()}
          onEndEdit={vi.fn()}
          supportsStreamModifiers={false}
        />
      </PanelContext.Provider>,
    );
  };

  it("puts the full value in the title, so a value clipped by the fixed column stays readable", () => {
    renderRow(1700000000.123456);
    expect(screen.getByTitle("1700000000.1235")).toBeTruthy();
  });

  it("shows a ROS 2 { sec, nanosec } stamp", () => {
    renderRow({ sec: 1700000000, nanosec: 500_000_000 });
    expect(screen.getByTitle("1700000000.5000")).toBeTruthy();
  });
});
