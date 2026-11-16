// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

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
        ],
        ["Zoom fit", "Fits the whole graph into the panel."],
        ["Orientation", "Switches between top-down and left-to-right layout."],
        ["Services", "Shows or hides service nodes."],
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
