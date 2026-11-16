// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { TOPIC_GRAPH_BUTTONS } from "./buttons";

const docs: PanelDocs = {
  intro: "Draws the live graph of nodes and the topics and services connecting them.",
  buttons: Object.values(TOPIC_GRAPH_BUTTONS),
  sections: [
    {
      title: "Data",
      items: [
        ["Live sources", "Needs a live connection that reports which nodes publish and subscribe."],
        [
          "View",
          "The graph refits as it changes, until you move the view yourself; then the view stays put.",
        ],
      ],
    },
  ],
};

export default docs;
