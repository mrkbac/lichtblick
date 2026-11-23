// SPDX-License-Identifier: MPL-2.0

import AddIcon from "@mui/icons-material/Add";
import CenterFocusWeakIcon from "@mui/icons-material/CenterFocusWeak";
import CloseIcon from "@mui/icons-material/Close";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import ZoomInIcon from "@mui/icons-material/ZoomIn";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";
import { shortcutById } from "@lichtblick/suite-base/util/keyboardShortcuts";

import { PLOT_SHORTCUTS } from "./shortcuts";

export const PLOT_BUTTONS = {
  resetView: {
    id: "plotResetView",
    icon: RestartAltIcon,
    placement: "toolbar",
    shortcut: shortcutById(PLOT_SHORTCUTS, "plot.resetView"),
  },
  legend: { id: "plotLegend", icon: FormatListBulletedIcon, placement: "toolbar" },
  boxZoom: {
    id: "plotBoxZoom",
    icon: ZoomInIcon,
    placement: "toolbar",
    shortcut: shortcutById(PLOT_SHORTCUTS, "plot.boxZoom"),
  },
  measure: { id: "plotMeasure", icon: CenterFocusWeakIcon, placement: "toolbar" },
  toggleSeries: { id: "plotToggleSeries", icon: CropSquareIcon, placement: "inline" },
  addSeries: { id: "plotAddSeries", icon: AddIcon, placement: "inline" },
  seriesSettings: { id: "plotSeriesSettings", icon: SettingsOutlinedIcon, placement: "inline" },
  deleteSeries: { id: "plotDeleteSeries", icon: CloseIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
