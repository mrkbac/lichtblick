// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Shows the latest values of a float32 array as shares of a pie chart.",
  sections: [
    {
      title: "Data",
      items: [
        [
          "Message path",
          "A float32[] field; each element becomes one slice, as a percentage of the sum.",
        ],
        ["Drag and drop", "Drop a float32[] field from the topic list to chart it."],
      ],
    },
    {
      title: "Settings",
      items: [
        ["Title", "Shown above the chart."],
        ["Legend controls", "Add or remove legend name fields."],
        ["Legend N", 'Name of the Nth slice; empty shows "Data N".'],
      ],
    },
    {
      title: "Mouse",
      items: [["Hover", "Shows a slice's name and percentage."]],
    },
  ],
};
export default docs;
