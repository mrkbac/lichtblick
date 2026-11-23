// SPDX-License-Identifier: MPL-2.0

import DiamondIcon from "@mui/icons-material/Diamond";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import RectangleOutlinedIcon from "@mui/icons-material/RectangleOutlined";
import SwapVertIcon from "@mui/icons-material/SwapVert";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const TOPIC_GRAPH_BUTTONS = {
  // Its tooltip says which topics are shown; drawn by ExpandingToolbar.
  topics: { id: "topicGraphTopics", icon: DiamondIcon, placement: "overlay" },
  zoomFit: { id: "topicGraphZoomFit", icon: FitScreenIcon, placement: "overlay" },
  orientation: {
    id: "topicGraphOrientation",
    icon: SwapVertIcon,
    placement: "overlay",
  },
  services: { id: "topicGraphServices", icon: RectangleOutlinedIcon, placement: "overlay" },
} as const satisfies Record<string, PanelButton>;
