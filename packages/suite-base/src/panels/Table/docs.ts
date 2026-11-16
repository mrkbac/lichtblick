// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { TABLE_BUTTONS } from "./buttons";

const docs: PanelDocs = {
  intro: "Shows the latest message, or an array inside it, as a sortable table.",
  buttons: Object.values(TABLE_BUTTONS),
  sections: [
    {
      title: "Data",
      items: [
        [
          "Message path",
          "Typed in the panel toolbar, e.g. /diagnostics.status; arrays become one row per element.",
        ],
        ["Rows per page", "10 by default; pick up to 50 below the table."],
      ],
    },
  ],
};
export default docs;
