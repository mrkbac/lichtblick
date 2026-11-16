// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import LibraryAddOutlinedIcon from "@mui/icons-material/LibraryAddOutlined";

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
          AddIcon,
        ],
        ["Expand", "Shows the value as a tree.", KeyboardArrowRightIcon],
        [
          "Add as row",
          "In the tree, adds that field as a row; Shift-click adds every field below it.",
          AddIcon,
        ],
      ],
    },
    {
      title: "Interactions",
      items: [
        ["Click a name", "Opens the path in a Plot panel."],
        ["Drag a row", "Reorder it, or drop it on another panel such as a Plot."],
        ["Copy value", "Copies the row's current value.", ContentCopyIcon],
        ["Edit path", "Edits the row's message path.", EditOutlinedIcon],
        ["Duplicate", "Adds a copy of the row below it.", LibraryAddOutlinedIcon],
        ["Remove", "Removes the row.", DeleteOutlineIcon],
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
