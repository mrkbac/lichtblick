// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { applyMovingAverage, IndexedDatum } from "./TimestampDatasetsBuilderImpl";

const data = (ys: number[]): IndexedDatum[] =>
  ys.map((y, index) => ({
    x: index,
    y,
    value: y,
    index,
    receiveTime: { sec: index, nsec: 0 },
  }));

describe("applyMovingAverage", () => {
  it("averages each sample with the samples before it", () => {
    // GIVEN five samples
    const items = data([1, 2, 3, 4, 5]);

    // WHEN smoothing over 3 samples
    applyMovingAverage(items, 3);

    // THEN the window grows to 3 samples and then slides
    expect(items.map((item) => item.y)).toEqual([1, 1.5, 2, 3, 4]);
    expect(items.map((item) => item.value)).toEqual([1, 1.5, 2, 3, 4]);
  });

  it("restarts the window after a line break", () => {
    // GIVEN a NaN line break between two runs
    const items = data([10, 20, NaN, 1, 3]);

    // WHEN smoothing over 2 samples
    applyMovingAverage(items, 2);

    // THEN the second run does not mix in values from the first
    expect(items.map((item) => item.y)).toEqual([10, 15, NaN, 1, 2]);
  });
});
