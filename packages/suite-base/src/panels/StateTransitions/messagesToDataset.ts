// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { subtract as subtractTimes, toSec } from "@foxglove/rostime";

import { ChartDataset } from "@lichtblick/suite-base/components/TimeBasedChart/types";
import { hashString } from "@lichtblick/suite-base/util/hashString";
import { expandedLineColors } from "@lichtblick/suite-base/util/plotColors";

import { conditionMatches, parseCondition } from "./condition";
import positiveModulo from "./positiveModulo";
import { MessageDatasetArgs, ValidQueriedDataValue } from "./types";

export const baseColors = [...expandedLineColors];
const baseColorsLength = Object.values(baseColors).length;
// Muted so the "true" bands of a condition stand out.
const CONDITION_FALSE_COLOR = "rgba(128, 128, 128, 0.35)";

/**
 * Processes messages into datasets. For performance reasons all values are condensed into a single
 * dataset with different labels and colors applied per-point.
 */
export function messagesToDataset(args: MessageDatasetArgs): ChartDataset {
  const { path, startTime, y, blocks, showPoints } = args;

  const dataset: ChartDataset = {
    borderWidth: 10,
    data: [],
    label: path.label ?? path.value,
    pointBackgroundColor: "rgba(0, 0, 0, 0.4)",
    pointBorderColor: "transparent",
    pointHoverRadius: 3,
    pointRadius: showPoints ? 1.25 : 0,
    pointStyle: "circle",
    showLine: true,
  };

  const condition = parseCondition(path.condition);

  let lastValue: string | number | bigint | boolean | undefined = undefined;
  let lastDatum: ChartDataset["data"][0] | undefined = undefined;

  for (const messages of blocks) {
    if (!messages) {
      continue;
    }

    for (const itemByPath of messages) {
      const timestamp =
        path.timestampMethod === "headerStamp" ? itemByPath.headerStamp : itemByPath.receiveTime;
      if (!timestamp) {
        continue;
      }

      // A path matching several values is invalid input (see datasetContainsArray)
      if (itemByPath.count !== 1) {
        continue;
      }

      const { constantName: rawConstantName, value: rawValue } = itemByPath;
      const x = toSec(subtractTimes(timestamp, startTime));

      // A null value marks a gap: break the line here and start a fresh segment once data resumes.
      // eslint-disable-next-line @lichtblick/strict-equality
      if (rawValue === null) {
        if (lastDatum != undefined) {
          dataset.data.push(lastDatum);
        }
        dataset.data.push({ x, y: Number.NaN });
        lastValue = undefined;
        lastDatum = undefined;
        continue;
      }

      if (!isValidValue(rawValue)) {
        continue;
      }

      // A condition series shows whether the comparison holds instead of the raw value.
      const value = condition ? conditionMatches(condition, rawValue, rawConstantName) : rawValue;
      const constantName = condition ? undefined : rawConstantName;

      const color = condition && value === false ? CONDITION_FALSE_COLOR : getColor(value);
      const label = createLabel(constantName, value);

      const isNewSegment = lastValue !== value;

      lastValue = value;
      lastDatum = {
        x,
        y,
        label: isNewSegment ? label : undefined,
        labelColor: color,
        value,
        constantName,
      };

      if (isNewSegment || showPoints) {
        dataset.data.push(lastDatum);

        // after we add a datum we clear the last datum so we don't try to add it again at the end
        lastDatum = undefined;
      }
    }
  }

  // If we never added the last datum (maybe because it was the same state as before), we add
  // it to the data so the user sees the state going until this point.
  if (lastDatum != undefined) {
    dataset.data.push(lastDatum);
  }

  return dataset;
}

export function isValidValue(value: unknown): value is number | string | bigint | boolean {
  // Check if the type of `value` is one of the desired types and that it's not `NaN`
  // null is handled separately by the caller as a gap marker, not a valid state value.
  return (
    (typeof value === "number" && !Number.isNaN(value)) ||
    typeof value === "string" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  );
}

export function getColor(value: ValidQueriedDataValue): string {
  const valueForColor = typeof value === "string" ? hashString(value) : Math.round(Number(value));
  return baseColors[positiveModulo(valueForColor, baseColorsLength)]!;
}

export function createLabel(
  constantName: string | undefined,
  value: ValidQueriedDataValue,
): string {
  return constantName != undefined ? `${constantName} (${String(value)})` : String(value);
}
