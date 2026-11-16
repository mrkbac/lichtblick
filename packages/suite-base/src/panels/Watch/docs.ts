// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Watch many values side by side, each with its age, a sparkline and change highlighting.",
  sections: [
    {
      title: "Data",
      items: [
        [
          "Message paths",
          "Any path, with filters and math modifiers, e.g. /odom.twist.twist.linear.x.@mul(3.6).",
        ],
        [
          "Add rows",
          "Type a path, paste several (one per line) or drag fields from the topic list.",
        ],
        [
          "Expand",
          "Shows the value as a tree; + adds a field as a row, Shift + adds every field below.",
        ],
      ],
    },
    {
      title: "Interactions",
      items: [
        ["Click a name", "Opens the path in a Plot panel."],
        ["Drag a row", "Reorder it, or drop it on another panel such as a Plot."],
        ["Row buttons", "Copy the value, edit the path, duplicate or remove the row."],
      ],
    },
    {
      title: "Settings",
      items: [
        ["Stale after (s)", "Values that haven't updated for longer are dimmed; per row override."],
        ["Label, Decimals, Unit", "Per row display options."],
        ["Sparklines, Flash on change, Show value age", "Toggle the extras for all rows."],
      ],
    },
  ],
};

export default docs;
