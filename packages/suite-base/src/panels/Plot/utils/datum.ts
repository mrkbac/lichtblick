// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toSec } from "@foxglove/rostime";

import { Time } from "@lichtblick/suite";
import { stampToTime } from "@lichtblick/suite-base/util/time";

// In addition to the base datum, we also add receiveTime and optionally header stamp to our datums
// These are used in the csv export.
export type Datum = { x: number; y: number } & {
  value: OriginalValue;
  receiveTime: Time;
  headerStamp?: Time;
};

export type OriginalValue = string | bigint | number | boolean | Time | null;

export function isChartValue(value: unknown): value is OriginalValue {
  // eslint-disable-next-line @lichtblick/strict-equality
  if (value === null) {
    return true;
  }
  switch (typeof value) {
    case "bigint":
    case "boolean":
    case "number":
    case "string":
      return true;
    case "object":
      return stampToTime(value) != undefined;
    default:
      return false;
  }
}

export function getChartValue(value: unknown): number | undefined {
  // eslint-disable-next-line @lichtblick/strict-equality
  if (value === null) {
    return Number.NaN;
  }
  switch (typeof value) {
    case "bigint":
      return Number(value);
    case "boolean":
      return Number(value);
    case "number":
      return value;
    case "object": {
      const time = stampToTime(value);
      return time ? toSec(time) : undefined;
    }
    case "string":
      // `+""` is 0; a blank string has no value, so it plots as a gap
      return value.trim() === "" ? Number.NaN : +value;
    default:
      return undefined;
  }
}

export type ChartDatum = { y: number; value: OriginalValue };

/**
 * Resolves a raw message-path item into a chart-safe {y, value} pair. Returns undefined when the
 * item cannot be plotted at all.
 *
 * A `null` item represents a gap: `y` is NaN (breaks the line/segment) but `value` stays `null`
 * (not NaN) so CSV export and tooltips render blank instead of the literal text "NaN".
 */
export function resolveChartDatum(item: unknown): ChartDatum | undefined {
  if (!isChartValue(item)) {
    return undefined;
  }
  // eslint-disable-next-line @lichtblick/strict-equality
  if (item === null) {
    return { y: Number.NaN, value: null };
  }
  const chartValue = getChartValue(item);
  if (chartValue == undefined) {
    return undefined;
  }

  if (Number.isNaN(chartValue)) {
    return { y: chartValue, value: null };
  }
  // Stamps are kept as `Time`, so the legend, hover, copy and delta read ROS 2 ones too
  return { y: chartValue, value: stampToTime(item) ?? item };
}
