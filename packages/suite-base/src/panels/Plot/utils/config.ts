// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Immutable } from "@lichtblick/suite";
import { PANEL_TITLE_CONFIG_KEY } from "@lichtblick/suite-base/util/layout";
import { TimestampMethod } from "@lichtblick/suite-base/util/time";

export type BasePlotPath = {
  value: string;
  enabled: boolean;
};

export type PlotPath = BasePlotPath & {
  color?: string;
  label?: string;
  timestampMethod: PlotTimestampMethod;
  /** Message path of the series' time, for the "customField" timestamp method. Same topic as `value`. */
  timestampPath?: string;
  showLine?: boolean;
  lineSize?: number;
  /** Dash pattern of the line in pixels (on, off, …); unset is solid */
  lineDash?: readonly number[];
  /** "step" holds each value until the next sample (sample-and-hold). */
  interpolation?: PlotInterpolation;
  /** Which y-axis the series is drawn against. */
  axis?: PlotYAxis;
  /** Per-series x-value path for "Path (accumulated)" plots; falls back to the panel x-axis path. */
  xValue?: string;
  /** Trailing moving-average window in samples for timestamp plots. 0 or unset disables it. */
  smoothing?: number;
  /** Reference lines only: "x" draws a vertical line at the value instead of a horizontal one. */
  referenceLineAxis?: PlotReferenceLineAxis;
  /** Reference lines only: unset draws a dashed line, like older layouts. */
  referenceLineDashed?: boolean;
  /** Horizontal reference lines only: shade where series are above or below the line (time plots). */
  referenceLineShade?: PlotReferenceLineShade;
  /** Message path of the series to shade; unset shades every series on the line's y axis. */
  referenceLineShadeSeries?: string;
};

export type PlotReferenceLineAxis = "y" | "x";
export type PlotReferenceLineShade = "none" | "above" | "below";
export type PlotInterpolation = "linear" | "step";
export type PlotYAxis = "primary" | "secondary";
export type PlotTimeWindow = "automatic" | "sliding" | "fixed";
export type PlotPlayheadPosition = "right" | "center";
/** x labels: seconds since start, wall-clock time, or seconds before the current time */
export type PlotTimestampFormat = "relative" | "absolute" | "relativeToNow";
export type PlotAxisScales = "independent" | "equal";
/** "fft" plots each series' frequency spectrum, "histogram" its value distribution */
export type PlotMode = "time" | "fft" | "histogram";
/** Which samples an FFT or histogram uses: the time window the time plot would show, or all */
export type PlotAnalysisRange = "visible" | "all";
/** Where a series' x value comes from on a time plot */
export type PlotTimestampMethod = TimestampMethod | "customField";

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

/** "auto" fits the visible data; "hold" never shrinks the axes while the view slides */
export type PlotYRangeMode = "auto" | "hold";

export type PlotLegendDisplay = "floating" | "top" | "left" | "none";

/**
 * A configured y bound as a number. Saved layouts store bounds as strings or numbers, and an
 * empty string or anything non-numeric means "auto" (`+""` would otherwise pin the axis at 0).
 */
export function yBound(value: string | number | undefined): number | undefined {
  if (value == undefined || (typeof value === "string" && value.trim() === "")) {
    return undefined;
  }
  const bound = Number(value);
  return Number.isFinite(bound) ? bound : undefined;
}

export type PlotConfig = DeprecatedPlotConfig & {
  paths: PlotPath[];
  minXValue?: number;
  maxXValue?: number;
  minYValue?: string | number;
  maxYValue?: string | number;
  /** Auto-scaling of the y axes; unset is "auto" */
  yRangeMode?: PlotYRangeMode;
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
  /** Logarithmic primary y-axis */
  yAxisLogScale?: boolean;
  /** Secondary y-axis settings. The axis shows when at least one series uses it. */
  y2AxisLabel?: string;
  showY2AxisLabels?: boolean;
  showY2AxisGrid?: boolean;
  minY2Value?: number;
  maxY2Value?: number;
  y2AxisLogScale?: boolean;
  /** Unset on older layouts; see getTimeWindow. */
  timeWindow?: PlotTimeWindow;
  playheadPosition?: PlotPlayheadPosition;
  timestampFormat?: PlotTimestampFormat;
  /** "equal" locks one x unit to one y unit (path x-axis plots only). */
  axisScales?: PlotAxisScales;
  followingViewWidth?: number;
  /** Unset on older layouts; see getPlotMode. */
  plotMode?: PlotMode;
  /** FFT and histogram input range. Unset means "visible". */
  analysisRange?: PlotAnalysisRange;
  /** Histogram bin count; unset picks one automatically */
  histogramBins?: number;
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

/** FFT and histogram are views of time plots; other x-axis modes always plot over their x. */
export function getPlotMode(
  config: Immutable<Pick<PlotConfig, "xAxisVal" | "plotMode">>,
): PlotMode {
  return config.xAxisVal === "timestamp" ? (config.plotMode ?? "time") : "time";
}
