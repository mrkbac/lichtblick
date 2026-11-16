// SPDX-License-Identifier: MPL-2.0

import {
  ArrowBidirectionalUpDown20Regular,
  Diamond20Filled,
  PageFit20Regular,
  RectangleLandscape20Regular,
} from "@fluentui/react-icons";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const TOPIC_GRAPH_BUTTONS = {
  // Its tooltip says which topics are shown; drawn by ExpandingToolbar.
  topics: { id: "topicGraphTopics", icon: Diamond20Filled, placement: "overlay" },
  zoomFit: { id: "topicGraphZoomFit", icon: PageFit20Regular, placement: "overlay" },
  orientation: {
    id: "topicGraphOrientation",
    icon: ArrowBidirectionalUpDown20Regular,
    placement: "overlay",
  },
  services: { id: "topicGraphServices", icon: RectangleLandscape20Regular, placement: "overlay" },
} as const satisfies Record<string, PanelButton>;
