// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import PlusIcon from "@mui/icons-material/AddBoxOutlined";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Shows the latest message, or an array inside it, as a sortable table.",
  sections: [
    {
      title: "Data",
      items: [
        [
          "Message path",
          "Typed in the panel toolbar, e.g. /diagnostics.status; arrays become one row per element.",
        ],
        ["Drag and drop", "Drop a field from the topic list to show it."],
      ],
    },
    {
      title: "Interactions",
      items: [
        ["Column header", "Click to sort; click again to reverse."],
        ["Expand", "Rows with nested messages or arrays open a sub-table.", PlusIcon],
        ["First page", "Jumps to the first page.", KeyboardDoubleArrowLeftIcon],
        ["Previous page", "Shows the previous page.", KeyboardArrowLeftIcon],
        ["Next page", "Shows the next page.", KeyboardArrowRightIcon],
        ["Last page", "Jumps to the last page.", KeyboardDoubleArrowRightIcon],
        ["Rows per page", "10 by default; pick up to 50 below the table."],
      ],
    },
  ],
};
export default docs;
