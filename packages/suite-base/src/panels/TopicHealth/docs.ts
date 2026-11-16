// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro:
    "Check every topic's rate against what you expect and spot slow or stale topics at a glance.",
  sections: [
    {
      title: "Table",
      items: [
        ["Status chips", "Click OK, Slow or Stale to show only those topics."],
        [
          "Expected",
          "Type an expected rate; leave empty to learn it from the data, 0 disables monitoring.",
        ],
        ["Topic name", "Click to open the topic in a Raw Messages panel."],
        [
          "Detailed statistics",
          "Scans or subscribes to a topic for jitter, max gap and bandwidth.",
        ],
        [
          "Not measured",
          "No rate is known for the topic; enable detailed statistics to measure it.",
        ],
      ],
    },
    {
      title: "Settings",
      items: [
        [
          "Slow below expected by (%)",
          "How far below the expected rate a topic may fall before it's slow.",
        ],
        ["Problems first", "Sort slow and stale topics to the top."],
        ["Stale after (s)", "Per topic override; by default five expected periods."],
      ],
    },
  ],
};

export default docs;
