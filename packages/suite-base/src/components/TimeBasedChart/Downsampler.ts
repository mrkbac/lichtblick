// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { RpcScales } from "@lichtblick/suite-base/components/Chart/types";
import { grey } from "@lichtblick/suite-base/util/toolsColorScheme";

import { MAX_POINTS } from "./downsample";
import { downsampleStates, sortedStateWindow } from "./downsampleStates";
import { ChartDatasets, PlotViewport } from "./types";

type UpdateParams = {
  datasets?: ChartDatasets;
  datasetBounds?: PlotViewport;
  scales?: RpcScales;
};

/**
 * Track a dataset, some bounds, a viewport to perform downsampling
 */
export class Downsampler {
  #datasets: ChartDatasets = [];
  #datasetBounds?: PlotViewport;
  #scales?: RpcScales;

  /**
   * Update internal state for next downsample
   */
  public update(opt: UpdateParams): void {
    this.#datasets = opt.datasets ?? this.#datasets;
    this.#datasetBounds = opt.datasetBounds ?? this.#datasetBounds;
    this.#scales = opt.scales ?? this.#scales;
  }

  /**
   * Perform a downsample with the latest state
   */
  public downsample(): ChartDatasets | undefined {
    const width = this.#datasetBounds?.width;
    const height = this.#datasetBounds?.height;

    const currentScales = this.#scales;
    let view: PlotViewport | undefined = undefined;
    if (currentScales?.x && currentScales.y) {
      view = {
        width: width ?? 0,
        height: height ?? 0,
        bounds: {
          x: {
            min: currentScales.x.min,
            max: currentScales.x.max,
          },
          y: {
            min: currentScales.y.min,
            max: currentScales.y.max,
          },
        },
      };
    }

    if (this.#datasetBounds == undefined) {
      return undefined;
    }

    return this.#datasets.map((dataset) => {
      if (!view) {
        return dataset;
      }

      // A sorted row holds no undefined points (see ChartDataset.xSorted).
      const { start, end } =
        dataset.xSorted === true
          ? sortedStateWindow(dataset.data as { x: number }[], view)
          : { start: 0, end: dataset.data.length };
      const downsampled = downsampleStates(
        dataset.data,
        view,
        // Per dataset: a shared split would leave each of many rows a few hundred points and
        // grey out stretches that fit the chart's width. The width still caps each row.
        MAX_POINTS,
        start,
        end,
      );
      // A merged stretch stays at the y of the point before it (a step row has several), else at
      // the row's first y. Gaps (y = NaN) don't count.
      let yValue = dataset.data.find((datum) => datum != undefined && !isNaN(datum.y))?.y ?? 0;
      const resolved = downsampled.map(({ x, index, states }) => {
        if (index == undefined) {
          return {
            x,
            y: yValue,
            labelColor: grey,
            label: "[...]",
            states,
          };
        }

        const point = dataset.data[index];
        if (point == undefined) {
          return point;
        }
        if (!isNaN(point.y)) {
          yValue = point.y;
        }

        return {
          ...point,
          x,
        };
      });

      // NaN item values create gaps in the line
      const undefinedToNanData = resolved.map((item) => {
        if (item == undefined || isNaN(item.x) || isNaN(item.y)) {
          return { x: NaN, y: NaN, value: NaN };
        }
        return item;
      });

      return { ...dataset, data: undefinedToNanData };
    });
  }
}
