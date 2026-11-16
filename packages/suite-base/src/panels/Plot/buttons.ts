// SPDX-License-Identifier: MPL-2.0

import {
  Add12Regular,
  ArrowCounterclockwise20Regular,
  Dismiss12Regular,
  PointScan20Regular,
  Square12Regular,
  TextBulletListLtr20Regular,
  ZoomIn20Regular,
} from "@fluentui/react-icons";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";
import { shortcutById } from "@lichtblick/suite-base/util/keyboardShortcuts";

import { PLOT_SHORTCUTS } from "./shortcuts";

export const PLOT_BUTTONS = {
  resetView: {
    id: "plotResetView",
    icon: ArrowCounterclockwise20Regular,
    placement: "toolbar",
    shortcut: shortcutById(PLOT_SHORTCUTS, "plot.resetView"),
  },
  legend: { id: "plotLegend", icon: TextBulletListLtr20Regular, placement: "toolbar" },
  boxZoom: {
    id: "plotBoxZoom",
    icon: ZoomIn20Regular,
    placement: "toolbar",
    shortcut: shortcutById(PLOT_SHORTCUTS, "plot.boxZoom"),
  },
  measure: { id: "plotMeasure", icon: PointScan20Regular, placement: "toolbar" },
  toggleSeries: { id: "plotToggleSeries", icon: Square12Regular, placement: "inline" },
  addSeries: { id: "plotAddSeries", icon: Add12Regular, placement: "inline" },
  deleteSeries: { id: "plotDeleteSeries", icon: Dismiss12Regular, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
