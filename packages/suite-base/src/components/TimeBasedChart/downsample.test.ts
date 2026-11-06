// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import { iterateObjects } from "@lichtblick/suite-base/components/Chart/datasets";

import {
  MINIMUM_PIXEL_DISTANCE,
  downsampleTimeseries,
  downsampleTimeseriesColumns,
  initDownsample,
  continueDownsample,
  finishDownsample,
  downsampleScatter,
  DownsampleState,
} from "./downsample";

describe("downsampleTimeseries", () => {
  const bounds = {
    width: 100,
    height: 100,
    bounds: { x: { min: 0, max: 100 }, y: { min: 0, max: 100 } },
  };

  it("merges nearby points", () => {
    const result = downsampleTimeseries(
      iterateObjects([
        { x: 0, y: 0, value: 0 },
        { x: 10, y: 0, value: 0 },
        { x: 20, y: 0, value: 0 },
        { x: 20, y: 1, value: 1 },
        { x: 20, y: 10, value: 10 },
        { x: 20, y: 20, value: 20 },
      ]),
      bounds,
    );
    expect(result).toEqual([0, 1, 2, 5]);
  });

  // This test ensures that splitting up the dataset into arbitrary pieces
  // still results in the same downsampled points.
  it("correctly pauses and resumes downsampling", () => {
    const realBounds = {
      width: 648,
      height: 1466,
      bounds: { x: { min: 0, max: 1785 }, y: { min: -1, max: 1 } },
    };

    const numPoints = 10_000;
    const deltaX = realBounds.bounds.x.max / numPoints;
    const dataset = _.range(0, numPoints).map((v) => {
      const x = v * deltaX;
      return {
        x,
        y: Math.cos(x),
        value: 0,
      };
    });

    const fullPoints = downsampleTimeseries(iterateObjects(dataset), realBounds);

    const numSplits = 400;
    const [indices, finalState] = _.chunk(dataset, Math.trunc(numPoints / numSplits)).reduce(
      (a: [number[], DownsampleState], v) => {
        const [oldIndices, oldState] = a;
        const [newIndices, newState] = continueDownsample(iterateObjects(v), oldState);
        return [[...oldIndices, ...newIndices], newState];
      },
      [[], initDownsample(realBounds)],
    );

    const partialPoints = [...indices, ...finishDownsample(finalState)];
    expect(fullPoints).toEqual(partialPoints);
  });

  it("preserves distinctly labeled segments", () => {
    const result = downsampleTimeseries(
      iterateObjects([
        { x: 0, y: 0, value: 0, label: "1" },
        { x: 10, y: 0, value: 0, label: "2" },
        { x: 20, y: 0, value: 0 },
        { x: 20, y: 1, value: 1 },
        { x: 20, y: 10, value: 10 },
        { x: 20, y: 20, value: 20 },
      ]),
      bounds,
    );
    expect(result).toEqual([0, 1, 2, 5]);
  });

  it("should keep the min/max values within an interval", () => {
    const result = downsampleTimeseries(
      iterateObjects([
        { x: 0, y: 0, value: 0 },
        { x: 0, y: 100, value: 100 },
        { x: 0, y: -20, value: -20 },
        { x: 0, y: 4, value: 4 },
      ]),
      bounds,
    );
    expect(result).toEqual([0, 1, 2, 3]);
  });

  it("should keep entry/exit datum to an interval", () => {
    const result = downsampleTimeseries(
      iterateObjects([
        { x: 0, y: 0, value: 0 },
        { x: 1, y: 0, value: 0 },
        { x: 1, y: 100, value: 100 },
        { x: 1, y: 4, value: 4 },
        { x: 2, y: 5, value: 5 },
      ]),
      {
        ...bounds,
        width: bounds.width * MINIMUM_PIXEL_DISTANCE,
      },
    );
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  it("should not produce out-of-order points", () => {
    const result = downsampleTimeseries(
      iterateObjects([
        { x: 0, y: 15, value: 0 },
        { x: 1, y: 100, value: 0 },
        { x: 2, y: 10, value: 0 },
        { x: 3, y: 15, value: 0 },
      ]),
      bounds,
      6, // two intervals
    );
    expect(result).toEqual([...result].sort((a, b) => a - b));
    expect(result).toEqual([0, 1, 2]);
  });
});

describe("downsampleScatter", () => {
  const bounds = {
    width: 100,
    height: 100,
    bounds: { x: { min: 0, max: 100 }, y: { min: 0, max: 100 } },
  };

  it("ignores out of bounds points", () => {
    const result = downsampleScatter(
      iterateObjects([
        { x: -1, y: 0, value: 0 },
        { x: 0, y: -1, value: -1 },
        { x: 200, y: 0, value: 0 },
        { x: 0, y: 200, value: 200 },
      ]),
      bounds,
    );
    expect(result).toEqual([1, 3]);
  });

  it("merges nearby points", () => {
    const result = downsampleScatter(
      iterateObjects([
        { x: 0, y: 0, value: 0 },
        { x: 0, y: 0.4, value: 0.4 },
        { x: 0, y: 0.8, value: 0.8 },
        { x: 0, y: 1, value: 1 },
      ]),
      bounds,
    );
    expect(result).toEqual([0, 2]);
  });
});

describe("downsampleTimeseriesColumns", () => {
  it("matches downsampleTimeseries on noisy data with gaps", () => {
    // GIVEN noisy data with NaN gaps
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const xs = new Float64Array(20_000);
    const ys = new Float64Array(20_000);
    for (let i = 0; i < xs.length; i++) {
      xs[i] = i / 10;
      ys[i] = random() < 0.01 ? NaN : Math.sin(i / 300) * 50 + random() * 10;
    }
    const view = {
      width: 800,
      height: 400,
      bounds: { x: { min: 100, max: 1900 }, y: { min: -60, max: 60 } },
    };
    const points = Array.from(xs, (x, i) => ({ x, y: ys[i]!, index: i })).slice(1000, 19_000);

    // THEN the columnar version returns the same indices
    expect(downsampleTimeseriesColumns(xs, ys, 1000, 19_000, view, 1000)).toEqual(
      downsampleTimeseries(points, view, 1000),
    );
  });
});
