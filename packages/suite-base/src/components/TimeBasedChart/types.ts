// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { ChartData as AbstractChartData } from "chart.js";

import type { ObjectData, ChartData } from "@lichtblick/suite-base/components/Chart/types";

// alias types for convenience
export type ChartDataset = ChartData["datasets"][0] & {
  /** Set when every point's x is >= the previous one's, so the chart can skip off-screen points. */
  xSorted?: boolean;
};
export type ChartDatasets = ChartDataset[];
export type ChartDatum = ChartDataset["data"][0];

export type Bounds1D = { min: number; max: number };
export type Bounds = {
  x: Bounds1D;
  y: Bounds1D;
};

/**
 * PlotViewport represents the visible region of a plot in terms of its axes
 * and its dimensions on the screen.
 */
export type PlotViewport = {
  // the dimensions of the plot in screen space
  width: number; // px
  height: number; // px
  // and its axes
  bounds: Bounds;
};

export type ProviderState = {
  data: AbstractChartData<"scatter", ObjectData>;
  // the bounds of the data contained in the `data` field
  bounds: Bounds;
};
