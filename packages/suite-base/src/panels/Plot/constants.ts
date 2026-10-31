// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { AnnotationOptions } from "chartjs-plugin-annotation";

import { PlotConfig, PlotPath } from "@lichtblick/suite-base/panels/Plot/utils/config";

export const DEFAULT_SIDEBAR_DIMENSION = 240;

export const DEFAULT_ANNOTATION: AnnotationOptions = {
  type: "line",
  display: true,
  drawTime: "beforeDatasetsDraw",
  scaleID: "y",
  borderWidth: 1,
  borderDash: [5, 5],
};

export const DEFAULT_PLOT_CONFIG: PlotConfig = {
  paths: [],
  minYValue: undefined,
  maxYValue: undefined,
  showXAxisLabels: true,
  showYAxisLabels: true,
  showLegend: true,
  legendDisplay: "floating",
  showPlotValuesInLegend: false,
  isSynced: true,
  xAxisVal: "timestamp",
  sidebarDimension: DEFAULT_SIDEBAR_DIMENSION,
  xAxisLabel: undefined,
  yAxisLabel: undefined,
};

export const DEFAULT_PLOT_PATH: PlotPath = Object.freeze({
  timestampMethod: "receiveTime",
  value: "",
  enabled: true,
});

export const DEFAULT_MARKER_COLOR = "#f44336";
