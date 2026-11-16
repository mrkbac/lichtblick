// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  ArrowBidirectionalUpDown20Regular,
  Diamond20Filled,
  PageFit20Regular,
  RectangleLandscape20Regular,
} from "@fluentui/react-icons";

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Draws the live graph of nodes and the topics and services connecting them.",
  sections: [
    {
      title: "Data",
      items: [
        ["Live sources", "Needs a live connection that reports which nodes publish and subscribe."],
      ],
    },
    {
      title: "Controls",
      items: [
        [
          "Topics",
          "Choose which topics to draw: all, none, published, subscribed or (dis)connected.",
          Diamond20Filled,
        ],
        ["Zoom fit", "Fits the whole graph into the panel.", PageFit20Regular],
        [
          "Orientation",
          "Switches between top-down and left-to-right layout.",
          ArrowBidirectionalUpDown20Regular,
        ],
        ["Services", "Shows or hides service nodes.", RectangleLandscape20Regular],
      ],
    },
    {
      title: "Mouse",
      items: [
        ["Drag / scroll", "Pan and zoom the graph; the view then stays put as the graph changes."],
      ],
    },
  ],
};

export default docs;
