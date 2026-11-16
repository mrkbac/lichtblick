/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// SPDX-FileCopyrightText: Copyright (C) 2025 Takayuki Honda <takayuki.honda@tier4.jp>
// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";

import PieChartBuilder from "@lichtblick/suite-base/testing/builders/PieChartBuilder";
import { expandedLineColors } from "@lichtblick/suite-base/util/plotColors";

import { useChartData } from "./useChartData";

describe("useChartData", () => {
  it("returns an empty array when rawValue is empty", () => {
    const rawValue = new Float32Array([]);
    const config = PieChartBuilder.pieChartConfig();
    const { result } = renderHook(() => useChartData(rawValue, config));
    expect(result.current).toEqual([]);
  });

  it("calculates percentages and assigns default names when legends are missing", () => {
    const rawValue = new Float32Array([10, 20, 30]);
    const config = PieChartBuilder.pieChartConfig();

    delete config.legend1;
    delete config.legend2;
    delete config.legend3;

    const { result } = renderHook(() => useChartData(rawValue, config));

    expect(result.current).toEqual([
      { name: "Data 1", value: 16.666666666666664, color: expandedLineColors[0] },
      { name: "Data 2", value: 33.33333333333333, color: expandedLineColors[1] },
      { name: "Data 3", value: 50, color: expandedLineColors[2] },
    ]);
  });

  it("uses legend names from config when provided", () => {
    const rawValue = new Float32Array([10, 20, 30]);
    const config = PieChartBuilder.pieChartConfig({
      legend1: "Legend A",
      legend2: "Legend B",
      legend3: "Legend C",
    });
    const { result } = renderHook(() => useChartData(rawValue, config));
    expect(result.current).toEqual([
      { name: "Legend A", value: 16.666666666666664, color: expandedLineColors[0] },
      { name: "Legend B", value: 33.33333333333333, color: expandedLineColors[1] },
      { name: "Legend C", value: 50, color: expandedLineColors[2] },
    ]);
  });

  it("trims legend names and assigns default names for empty legends", () => {
    const rawValue = new Float32Array([10, 20]);
    const config = PieChartBuilder.pieChartConfig({
      legend1: "  ",
      legend2: "Valid Legend",
    });
    const { result } = renderHook(() => useChartData(rawValue, config));
    expect(result.current).toEqual([
      { name: "Data 1", value: 33.33333333333333, color: expandedLineColors[0] },
      { name: "Valid Legend", value: 66.66666666666666, color: expandedLineColors[1] },
    ]);
  });

  it("handles a single data point correctly", () => {
    const rawValue = new Float32Array([100]);
    const config = PieChartBuilder.pieChartConfig({ legend1: "Single Data" });
    const { result } = renderHook(() => useChartData(rawValue, config));
    expect(result.current).toEqual([
      { name: "Single Data", value: 100, color: expandedLineColors[0] },
    ]);
  });

  it("returns no slices when nothing is positive", () => {
    const config = PieChartBuilder.pieChartConfig();
    expect(renderHook(() => useChartData(new Float32Array([0, 0]), config)).result.current).toEqual(
      [],
    );
    expect(
      renderHook(() => useChartData(new Float32Array([-1, 0]), config)).result.current,
    ).toEqual([]);
  });

  it("treats negative values as empty slices", () => {
    const config = PieChartBuilder.pieChartConfig();
    const { result } = renderHook(() => useChartData(new Float32Array([-5, 10]), config));
    expect(result.current.map((datum) => datum.value)).toEqual([0, 100]);
  });

  it("keeps slice colors distinct past ten values", () => {
    const config = PieChartBuilder.pieChartConfig();
    const rawValue = new Float32Array(Array.from({ length: 12 }, () => 1));
    const { result } = renderHook(() => useChartData(rawValue, config));
    expect(new Set(result.current.map((datum) => datum.color)).size).toBe(12);
  });
});
