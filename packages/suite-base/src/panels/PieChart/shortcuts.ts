// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Display only: handled by Chart.js tooltips and the panel's message path drop config. */
export const PIE_CHART_SHORTCUTS = [
  {
    id: "pieChart.showSlice",
    titleKey: "pieChartShowSlice",
    keys: [],
    mouse: [{ action: "hover" }],
  },
  { id: "pieChart.dropPath", titleKey: "pieChartDropPath", keys: [], mouse: [{ action: "drop" }] },
] as const satisfies readonly KeyboardShortcut[];
