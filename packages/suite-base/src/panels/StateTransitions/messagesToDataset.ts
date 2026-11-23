// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time, subtract as subtractTimes, toSec } from "@foxglove/rostime";
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

type Datum = ChartDataset["data"][0];

type ConversionState = {
  lastValue?: string | number | bigint | boolean;
  lastDatum?: Datum;
  lastIndex: number;
  repeatBlock?: PathSampleColumns;
  repeatIndex: number;
  segment?: Datum;
  /** The x of the last pushed point, and whether any point went back from it. */
  lastX: number;
  unsorted: boolean;
};

export type LiveDatasetCache = {
  checkpoint?: {
    args: MessageDatasetArgs;
    block: PathSampleColumns;
    revision: number;
    end: number;
    data: ChartDataset["data"];
    origin: Time;
    state: ConversionState;
  };
};

/**
 * Processes messages into datasets. For performance reasons all values are condensed into a single
 * dataset with different labels and colors applied per-point.
 */
export function messagesToDataset(
  args: MessageDatasetArgs,
  liveCache?: LiveDatasetCache,
): ChartDataset {
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

  const liveBlock = liveCache != undefined && blocks.length === 1 ? blocks[0] : undefined;
  const cached = liveCache?.checkpoint;
  const checkpoint =
    liveBlock != undefined &&
    cached?.block === liveBlock &&
    cached.revision === liveBlock.prefixRevision() &&
    cached.args.path === path &&
    cached.args.y === y &&
    cached.args.showPoints === showPoints &&
    (cached.args.darkenLabels ?? false) === darkenLabels
      ? cached
      : undefined;
  if (
    checkpoint &&
    (checkpoint.origin.sec !== startTime.sec || checkpoint.origin.nsec !== startTime.nsec)
  ) {
    // Live players can move the playback start forward as their rewind buffer fills. Shift the
    // cached points onto the new axis in place: no per-point allocation or timestamp lookup.
    // ponytail: each shift may round x by an ulp (~1e-13 s); rebuild from timestamps if that drift
    // ever shows.
    const shift = toSec(subtractTimes(startTime, checkpoint.origin));
    for (const point of checkpoint.data) {
      point!.x -= shift;
    }
    const { state: cachedState } = checkpoint;
    cachedState.lastX -= shift;
    if (cachedState.lastDatum) {
      cachedState.lastDatum = { ...cachedState.lastDatum, x: cachedState.lastDatum.x - shift };
    }
    checkpoint.origin = startTime;
  }
  const useHeaderStamp = path.timestampMethod === "headerStamp";
  const xOf = (messages: PathSampleColumns, i: number) => {
    const timestamp = useHeaderStamp ? messages.headerStamp(i) : messages.receiveTime(i);
    return timestamp ? toSec(subtractTimes(timestamp, startTime)) : undefined;
  };

  // A repeat with hidden points updates the segment end only, so hold it until the segment ends.
  const state: ConversionState = checkpoint
    ? { ...checkpoint.state }
    : { lastIndex: -1, repeatIndex: 0, lastX: -Infinity, unsorted: false };
  const data = checkpoint?.data ?? dataset.data;
  const pushPoint = (point: NonNullable<Datum>) => {
    data.push(point);
    if (point.x < state.lastX) {
      state.unsorted = true;
    }
    state.lastX = point.x;
  };
  const takeRepeat = () => {
    if (state.repeatBlock && state.segment) {
      const { labelColor, value, constantName } = state.segment;
      const x = xOf(state.repeatBlock, state.repeatIndex)!;
      state.lastDatum = { x, y, label: undefined, labelColor, value, constantName };
    }
    state.repeatBlock = undefined;
  };
  const flush = () => {
    takeRepeat();
    if (state.lastDatum != undefined) {
      pushPoint(state.lastDatum);
    }
    state.lastDatum = undefined;
  };

  const append = (messages: PathSampleColumns, start: number, end: number) => {
    for (let i = start; i < end; i++) {
      if (!showPoints && state.lastIndex !== -1 && messages.sameValue(state.lastIndex, i)) {
        if (!useHeaderStamp || messages.hasHeaderStamp(i)) {
          state.repeatBlock = messages;
          state.repeatIndex = i;
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
        pushPoint({ x, y, label: "[...]", labelColor: grey, value: undefined });
        state.lastValue = undefined;
        state.lastIndex = i;
        state.segment = undefined;
        continue;
      }

      const { constantName: rawConstantName, value: rawValue } = sample;

      // A null value marks a gap: break the line here and start a fresh segment once data resumes.
      // eslint-disable-next-line @lichtblick/strict-equality
      if (rawValue === null) {
        flush();
        pushPoint({ x, y: Number.NaN });
        state.lastValue = undefined;
        state.lastIndex = -1;
        continue;
      }

      if (!isValidValue(rawValue)) {
        continue;
      }

      // A condition series shows whether the comparison holds instead of the raw value.
      const value = condition ? conditionMatches(condition, rawValue, rawConstantName) : rawValue;
      const constantName = condition ? undefined : rawConstantName;

      if (i === 0 && messages.startsWithContext()) {
        // Only the state before the first kept change: carry it, don't draw it as a change.
        state.lastValue = value;
        state.lastIndex = i;
        continue;
      }

      const color = condition && value === false ? CONDITION_FALSE_COLOR : getColor(value);
      const label = createLabel(constantName, value);

      const isNewSegment = state.lastValue !== value;

      takeRepeat();
      state.lastValue = value;
      state.lastIndex = i;
      state.lastDatum = {
        x,
        y,
        label: isNewSegment ? label : undefined,
        labelColor: color,
        ...(isNewSegment && darkenLabels && { labelTextColor: darken(color, 0.45) }),
        value,
        constantName,
      };
      state.segment = state.lastDatum;

      if (isNewSegment || showPoints) {
        pushPoint(state.lastDatum);

        // after we add a datum we clear the last datum so we don't try to add it again at the end
        state.lastDatum = undefined;
      }
    }
  };

  if (liveCache && liveBlock) {
    // Appends can overwrite the last two rows. Cache only the stable prefix and rewind the
    // temporary tail once the chart has its own data array.
    const stableEnd = Math.max(0, liveBlock.size() - 2);
    append(liveBlock, checkpoint?.end ?? 0, stableEnd);
    liveCache.checkpoint = {
      args,
      block: liveBlock,
      revision: liveBlock.prefixRevision(),
      end: stableEnd,
      data,
      origin: startTime,
      state: { ...state },
    };
    const stableLength = data.length;
    append(liveBlock, stableEnd, liveBlock.size());
    flush();
    dataset.data = data.slice();
    dataset.xSorted = !state.unsorted;
    data.length = stableLength;
    return dataset;
  }

  for (const messages of blocks) {
    if (messages) {
      // Samples are only compared within a block.
      state.lastIndex = -1;
      append(messages, 0, messages.size());
    }
  }
  // If we never added the last datum (maybe because it was the same state as before), we add
  // it to the data so the user sees the state going until this point.
  flush();
  dataset.xSorted = !state.unsorted;

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
