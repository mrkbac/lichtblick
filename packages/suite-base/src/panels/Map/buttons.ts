// SPDX-License-Identifier: MPL-2.0

import AddLocationAltOutlinedIcon from "@mui/icons-material/AddLocationAltOutlined";
import ChangeHistoryIcon from "@mui/icons-material/ChangeHistory";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import HeightIcon from "@mui/icons-material/Height";
import StraightenIcon from "@mui/icons-material/Straighten";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const MAP_BUTTONS = {
  zoomToData: { id: "mapZoomToData", icon: FitScreenIcon, placement: "overlay" },
  measuringTools: { id: "mapMeasuringTools", icon: StraightenIcon, placement: "overlay" },
  distance: { id: "mapMeasureDistance", icon: StraightenIcon, placement: "overlay" },
  height: { id: "mapMeasureHeight", icon: HeightIcon, placement: "overlay" },
  angle: { id: "mapMeasureAngle", icon: ChangeHistoryIcon, placement: "overlay" },
  point: { id: "mapPinPoints", icon: AddLocationAltOutlinedIcon, placement: "overlay" },
  clearAll: { id: "mapClearMeasurements", icon: DeleteOutlinedIcon, placement: "overlay" },
} as const satisfies Record<string, PanelButton>;
