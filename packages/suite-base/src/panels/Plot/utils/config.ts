// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@foxglove/rostime";

import { Immutable } from "@lichtblick/suite";
import { MessagePathDataItem } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { MessageEvent } from "@lichtblick/suite-base/players/types";
import { PANEL_TITLE_CONFIG_KEY } from "@lichtblick/suite-base/util/layout";
import { TimestampMethod } from "@lichtblick/suite-base/util/time";

export type Messages = Record<string, MessageEvent[]>;

export type BasePlotPath = {
  value: string;
  enabled: boolean;
};

export type PlotPath = BasePlotPath & {
  color?: string;
  label?: string;
  timestampMethod: TimestampMethod;
  showLine?: boolean;
  lineSize?: number;
  /** "step" holds each value until the next sample (sample-and-hold). */
  interpolation?: PlotInterpolation;
  /** Which y-axis the series is drawn against. */
  axis?: PlotYAxis;
  /** Per-series x-value path for "Path (accumulated)" plots; falls back to the panel x-axis path. */
  xValue?: string;
  /** Trailing moving-average window in samples for timestamp plots. 0 or unset disables it. */
  smoothing?: number;
};

export type PlotInterpolation = "linear" | "step";
export type PlotYAxis = "primary" | "secondary";
export type PlotTimeWindow = "automatic" | "sliding" | "fixed";
export type PlotPlayheadPosition = "right" | "center";
export type PlotTimestampFormat = "relative" | "absolute";
export type PlotAxisScales = "independent" | "equal";

export type PlotXAxisVal =
  // x-axis is either receive time since start or header stamp since start
  | "timestamp"
  // The message path values from the latest message for each series. The x-axis is the array
  // "index" of the item and y-axis is the item value
  | "index"
  // The x-axis are values from message path items (accumulated). Each series produces y-values from
  // its message path items. The x/y values are paired by their respective array index locations.
  | "custom"
  // Similar to "index" mode except the x-axis the message path item values and the y-axis are the
  // correspondible series message path value at the same array index. Only the latest message is used
  // for x-axis and each series
  | "currentCustom";

export type PlotDataItem = {
  queriedData: MessagePathDataItem[];
  receiveTime: Time;
  headerStamp?: Time;
};

/**
 * A "reference line" plot path is a numeric value. It creates a horizontal line on the plot at the
 * specified value.
 * @returns true if the series config is a reference line
 */
export function isReferenceLinePlotPathType(path: Immutable<PlotPath>): boolean {
  return !Number.isNaN(Number.parseFloat(path.value));
}

/**
 * Coalesces null, undefined and empty string to undefined.
 */
function presence<T>(value: undefined | T): undefined | T {
  if (value === "") {
    return undefined;
  }

  return value ?? undefined;
}

export function plotPathDisplayName(path: Readonly<PlotPath>, index: number): string {
  return presence(path.label) ?? presence(path.value) ?? `Series ${index + 1}`;
}
type DeprecatedPlotConfig = {
  showSidebar?: boolean;
  sidebarWidth?: number;
};

export type PlotLegendDisplay = "floating" | "top" | "left" | "none";

export type PlotConfig = DeprecatedPlotConfig & {
  paths: PlotPath[];
  minXValue?: number;
  maxXValue?: number;
  minYValue?: string | number;
  maxYValue?: string | number;
  showLegend: boolean;
  legendDisplay: PlotLegendDisplay;
  showPlotValuesInLegend: boolean;
  showXAxisLabels: boolean;
  showYAxisLabels: boolean;
  isSynced: boolean;
  xAxisVal: PlotXAxisVal;
  xAxisPath?: BasePlotPath;
  xAxisLabel?: string;
  yAxisLabel?: string;
  showXAxisGrid?: boolean;
  showYAxisGrid?: boolean;
  /** Secondary y-axis settings. The axis shows when at least one series uses it. */
  y2AxisLabel?: string;
  showY2AxisLabels?: boolean;
  showY2AxisGrid?: boolean;
  minY2Value?: number;
  maxY2Value?: number;
  /** Unset on older layouts; see getTimeWindow. */
  timeWindow?: PlotTimeWindow;
  playheadPosition?: PlotPlayheadPosition;
  timestampFormat?: PlotTimestampFormat;
  /** "equal" locks one x unit to one y unit (path x-axis plots only). */
  axisScales?: PlotAxisScales;
  followingViewWidth?: number;
  sidebarDimension: number;
  [PANEL_TITLE_CONFIG_KEY]?: string;
};

/**
 * The time window of a timestamp plot. Older layouts have no `timeWindow` and express it through
 * `followingViewWidth` (sliding) or `minXValue`/`maxXValue` (fixed).
 */
export function getTimeWindow(config: Immutable<PlotConfig>): PlotTimeWindow {
  if (config.timeWindow) {
    return config.timeWindow;
  }
  if (config.followingViewWidth != undefined) {
    return "sliding";
  }
  if (config.minXValue != undefined || config.maxXValue != undefined) {
    return "fixed";
  }
  return "automatic";
}
