// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { subtract as subtractTimes, toSec } from "@foxglove/rostime";
import { darken } from "@mui/material";

import { PathSampleColumns } from "@lichtblick/suite-base/components/MessagePathSyntax/PathSampleColumns";
import { ChartDataset } from "@lichtblick/suite-base/components/TimeBasedChart/types";
import { hashString } from "@lichtblick/suite-base/util/hashString";
import { expandedLineColors } from "@lichtblick/suite-base/util/plotColors";
import { grey } from "@lichtblick/suite-base/util/toolsColorScheme";

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
  const { path, startTime, y, blocks, showPoints, darkenLabels = false } = args;

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

  const useHeaderStamp = path.timestampMethod === "headerStamp";
  const xOf = (messages: PathSampleColumns, i: number) => {
    const timestamp = useHeaderStamp ? messages.headerStamp(i) : messages.receiveTime(i);
    return timestamp ? toSec(subtractTimes(timestamp, startTime)) : undefined;
  };

  let lastValue: string | number | bigint | boolean | undefined = undefined;
  let lastDatum: ChartDataset["data"][0] | undefined = undefined;
  // With points hidden, a repeat of the last drawn sample's value only moves where its segment
  // ends, so it is just remembered here (a typed-array compare) and drawn when the segment ends.
  let lastIndex = -1;
  let repeatBlock: PathSampleColumns | undefined;
  let repeatIndex = 0;
  let segment: ChartDataset["data"][0] | undefined;
  const takeRepeat = () => {
    if (repeatBlock && segment) {
      const { labelColor, value, constantName } = segment;
      const x = xOf(repeatBlock, repeatIndex)!;
      lastDatum = { x, y, label: undefined, labelColor, value, constantName };
    }
    repeatBlock = undefined;
  };
  const flush = () => {
    takeRepeat();
    if (lastDatum != undefined) {
      dataset.data.push(lastDatum);
    }
    lastDatum = undefined;
  };

  for (const messages of blocks) {
    if (!messages) {
      continue;
    }
    // Samples are only compared within a block.
    lastIndex = -1;

    for (let i = 0; i < messages.size(); i++) {
      if (!showPoints && lastIndex !== -1 && messages.sameValue(lastIndex, i)) {
        if (!useHeaderStamp || messages.hasHeaderStamp(i)) {
          repeatBlock = messages;
          repeatIndex = i;
        }
        continue;
      }

      const sample = messages.sampleValue(i);
      // A path matching several values is invalid input (see datasetContainsArray)
      if (sample.count !== 1) {
        continue;
      }

      const x = xOf(messages, i);
      if (x == undefined) {
        continue;
      }

      // A thinned stretch that held several values: draw it as one, like the chart's own [...].
      if (messages.isMixed(i)) {
        flush();
        dataset.data.push({ x, y, label: "[...]", labelColor: grey, value: undefined });
        lastValue = undefined;
        lastIndex = i;
        segment = undefined;
        continue;
      }

      const { constantName: rawConstantName, value: rawValue } = sample;

      // A null value marks a gap: break the line here and start a fresh segment once data resumes.
      // eslint-disable-next-line @lichtblick/strict-equality
      if (rawValue === null) {
        flush();
        dataset.data.push({ x, y: Number.NaN });
        lastValue = undefined;
        lastIndex = -1;
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

      takeRepeat();
      lastValue = value;
      lastIndex = i;
      lastDatum = {
        x,
        y,
        label: isNewSegment ? label : undefined,
        labelColor: color,
        ...(isNewSegment && darkenLabels && { labelTextColor: darken(color, 0.45) }),
        value,
        constantName,
      };
      segment = lastDatum;

      if (isNewSegment || showPoints) {
        dataset.data.push(lastDatum);

        // after we add a datum we clear the last datum so we don't try to add it again at the end
        lastDatum = undefined;
      }
    }
  }

  // If we never added the last datum (maybe because it was the same state as before), we add
  // it to the data so the user sees the state going until this point.
  flush();

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
