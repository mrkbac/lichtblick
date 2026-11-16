// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { ALLOWED_DATATYPES } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";

const docs: PanelDocs = {
  intro: "Lists every diagnostic check with its current level, worst first.",
  schemas: ALLOWED_DATATYPES,
  sections: [
    {
      title: "Toolbar",
      items: [
        ["Level", "Hide checks below the chosen level (OK, WARN, ERROR, STALE)."],
        ["Filter", "Fuzzy-matches hardware ID and check name."],
      ],
    },
    {
      title: "Settings",
      items: [
        ["Topics", "Which DiagnosticArray topics to read; all of them by default."],
        ["Sort by level", "Group checks by level, worst first; off sorts by name."],
        ["Show history", "Draw a status timeline for each check."],
        ["Stale timeout", "Seconds without updates before a check is marked stale."],
      ],
    },
    {
      title: "Mouse",
      items: [
        ["Click a row", "Opens the check in a Diagnostics – Detail panel."],
        ["Pin", "Keeps a check at the top of the list."],
        ["Click the timeline", "Seeks playback to that time."],
        ["Drop a topic", "Drag a diagnostics topic onto the panel to add it."],
      ],
    },
  ],
};

export default docs;
