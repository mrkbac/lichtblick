// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { computeRangeStats } from "./RangeStats";
import { CsvDataset } from "./builders/IDatasetsBuilder";

function dataset(configIndex: number, points: [number, number][]): CsvDataset {
  return {
    label: `/topic.value${configIndex}`,
    configIndex,
    data: points.map(([x, y]) => ({ x, y, receiveTime: { sec: x, nsec: 0 }, value: y })),
  };
}

describe("computeRangeStats", () => {
  it("summarizes the samples inside the range, edges included", () => {
    // GIVEN samples from 0 s to 4 s
    const datasets = [
      dataset(2, [
        [0, 100],
        [1, 1],
        [2, 3],
        [3, -1],
        [4, 100],
      ]),
    ];

    // WHEN the range is 1 s to 3 s
    const [stat] = computeRangeStats(datasets, 1, 3);

    // THEN only the three samples inside count
    expect(stat).toEqual({
      configIndex: 2,
      count: 3,
      min: -1,
      max: 3,
      mean: 1,
      rms: Math.sqrt(11 / 3),
      std: Math.sqrt(11 / 3 - 1),
    });
  });

  it("skips line breaks and series without samples in the range", () => {
    // GIVEN one series with a NaN line break and one that ends before the range
    const datasets = [
      dataset(0, [
        [1, NaN],
        [2, 4],
      ]),
      dataset(1, [[0, 1]]),
    ];

    // WHEN the range is 1 s to 2 s
    const stats = computeRangeStats(datasets, 1, 2);

    // THEN only the finite sample of the first series counts
    expect(stats).toEqual([{ configIndex: 0, count: 1, min: 4, max: 4, mean: 4, rms: 4, std: 0 }]);
  });
});
