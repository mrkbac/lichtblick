// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Immutable } from "@lichtblick/suite";
import { parseColor, toHex8 } from "@lichtblick/suite-base/util/parseColor";

import { Dataset, ReferenceLine } from "../types";

const SHADE_ALPHA = 0.25;

/**
 * Fill-only datasets for shaded reference lines (thresholds), drawn with chart.js' native Filler
 * against `{ value }`. They reuse each series' (downsampled) data array and skip parsing, so a
 * shaded series costs one extra fill path and no copies. They go after the series datasets, which
 * keeps dataset index == config index for the series, and chart.js draws later datasets first, so
 * the fills sit under the lines.
 */
export function buildThresholdFills(
  datasets: readonly Dataset[],
  lines: Immutable<ReferenceLine[]> | undefined,
): Dataset[] {
  const fills: Dataset[] = [];
  for (const line of lines ?? []) {
    if (!line.shade || line.scaleID === "x") {
      continue;
    }
    const scaleID = line.scaleID ?? "y";
    const color = toHex8(parseColor(line.color).alpha(SHADE_ALPHA));
    datasets.forEach((dataset, index) => {
      if (
        dataset.data.length === 0 ||
        (dataset.yAxisID ?? "y") !== scaleID ||
        (line.shadeSeries != undefined && !line.shadeSeries.includes(index))
      ) {
        return;
      }
      fills.push({
        data: dataset.data,
        parsing: false,
        yAxisID: scaleID,
        stepped: dataset.stepped,
        showLine: true,
        borderWidth: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        pointHitRadius: 0,
        fill: {
          target: { value: line.value },
          above: line.shade === "above" ? color : "transparent",
          below: line.shade === "below" ? color : "transparent",
        },
      });
    });
  }
  return fills;
}
