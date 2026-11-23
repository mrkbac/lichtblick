// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Downsampler } from "./Downsampler";
import { ChartDatasets } from "./types";

describe("Downsampler", () => {
  it("reads only the visible window of a sorted row, with the same result", () => {
    const data = Array.from({ length: 10_000 }, (_, i) => ({
      x: i / 10,
      y: i % 97 === 0 ? Number.NaN : -1,
      label: i % 97 === 0 ? undefined : String(Math.floor(i / 3) % 2),
      value: Math.floor(i / 3) % 2,
    }));
    const downsample = ({ xSorted }: { xSorted: boolean }) => {
      const downsampler = new Downsampler();
      downsampler.update({
        datasets: [{ data, xSorted }],
        datasetBounds: {
          width: 300,
          height: 100,
          bounds: { x: { min: 400, max: 450 }, y: { min: -2, max: 0 } },
        },
        scales: {
          x: { min: 400, max: 450, pixelMin: 0, pixelMax: 300 },
          y: { min: -2, max: 0, pixelMin: 100, pixelMax: 0 },
        },
      });
      return downsampler.downsample()?.map((dataset) => dataset.data);
    };
    expect(downsample({ xSorted: true })).toEqual(downsample({ xSorted: false }));
  });

  it("gives every row the chart's width, however many rows there are", () => {
    // 20 rows, each changing state every 6 px on a 1500 px chart: all fit.
    const transitions = 250;
    const datasets: ChartDatasets = Array.from({ length: 20 }, (_, row) => ({
      data: Array.from({ length: transitions }, (_unused, i) => ({
        x: i,
        y: -row,
        label: String(i % 2),
        value: i % 2,
      })),
    }));
    const downsampler = new Downsampler();
    downsampler.update({
      datasets,
      datasetBounds: {
        width: 1500,
        height: 400,
        bounds: { x: { min: 0, max: transitions }, y: { min: -20, max: 0 } },
      },
      scales: {
        x: { min: 0, max: transitions, pixelMin: 0, pixelMax: 1500 },
        y: { min: -20, max: 0, pixelMin: 400, pixelMax: 0 },
      },
    });

    for (const dataset of downsampler.downsample() ?? []) {
      expect(dataset.data.filter((datum) => datum?.label === "[...]")).toEqual([]);
      expect(dataset.data).toHaveLength(transitions);
    }
  });

  it("draws dense stretches on the row even when the row starts with a gap", () => {
    const data = [
      { x: 0, y: Number.NaN },
      // Many changes within one pixel: drawn as one grey [...] stretch.
      ...Array.from({ length: 50 }, (_, i) => ({
        x: 10 + i * 0.001,
        y: -3,
        label: String(i % 2),
        value: i % 2,
      })),
      { x: 20, y: -3, label: "0", value: 0 },
    ];
    const downsampler = new Downsampler();
    downsampler.update({
      datasets: [{ data }],
      datasetBounds: {
        width: 100,
        height: 100,
        bounds: { x: { min: 0, max: 20 }, y: { min: -5, max: 0 } },
      },
      scales: {
        x: { min: 0, max: 20, pixelMin: 0, pixelMax: 100 },
        y: { min: -5, max: 0, pixelMin: 100, pixelMax: 0 },
      },
    });
    const [row] = downsampler.downsample() ?? [];
    const dense = row?.data.filter((datum) => datum?.label === "[...]") ?? [];
    expect(dense.length).toBeGreaterThan(0);
    expect(dense.every((datum) => datum?.y === -3)).toBe(true);
  });
});
