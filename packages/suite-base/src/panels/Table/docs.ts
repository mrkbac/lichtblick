// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

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
        ["Expand", "Rows with nested messages or arrays open a sub-table."],
        ["Pages", "Ten rows per page; use the buttons below the table to page."],
      ],
    },
  ],
};
export default docs;
