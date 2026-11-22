// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Downsampler } from "./Downsampler";
import { ChartDatasets } from "./types";

describe("Downsampler", () => {
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
});
