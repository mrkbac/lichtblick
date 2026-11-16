// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { ALLOWED_DATATYPES } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";

const docs: PanelDocs = {
  intro: "Shows the key/value details of one diagnostic check or all checks of one hardware ID.",
  schemas: ALLOWED_DATATYPES,
  sections: [
    {
      title: "Data",
      items: [
        ["Pick a check", "Type in the toolbar to choose a hardware ID or a single check."],
        ["From the summary", "Clicking a row in Diagnostics – Summary opens it here."],
      ],
    },
    {
      title: "Settings",
      items: [
        ["Topics", "Which DiagnosticArray topics to read; all of them by default."],
        ["Numeric precision", "Decimal places for numeric values; auto when empty."],
        ["Stale timeout", "Seconds without updates before a check is marked stale."],
      ],
    },
    {
      title: "Mouse",
      items: [
        ["Hover a value", "Changed values flash; the tooltip shows the previous value."],
        ["Plot button", "Opens a numeric value in Plot, text in State Transitions."],
        ["Copy", "Copy a single value, or the whole status as JSON."],
        ["Click the timeline", "Seeks playback to that time."],
        ["Drag the divider", "Resizes the key and value columns."],
      ],
    },
  ],
};

export default docs;
