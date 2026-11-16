// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import SearchIcon from "@mui/icons-material/Search";

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro:
    "Inspect the open recording or live source: topics, timing, files, channels, schemas and metadata.",
  sections: [
    {
      title: "Topics & timing",
      items: [
        [
          "Scan",
          "Reads messages to measure activity, frequency, jitter, size and the largest interval.",
          SearchIcon,
        ],
        [
          "Topic name",
          "Click to expand details such as first and last message and frequency range.",
        ],
        ["Largest interval", "Click to seek to the start of the gap."],
        ["Activity chart", "Click a bar to seek there."],
        ["List / Tree", "Show topics flat or grouped by namespace with totals."],
        ["Sort direction", "Flips the order of the chosen sort column.", ArrowUpwardIcon],
        [
          "Rate basis",
          "Compute Hz over the recording span, the topic's active span or the median interval.",
        ],
      ],
    },
    {
      title: "Tabs",
      items: [
        ["File", "Writer, size, compression and indexing of each file."],
        ["Channels, Schemas, Metadata", "Raw details stored in the file."],
        [
          "Compare",
          "With several recordings open side by side, shows topics that are missing or differ in schema or rate.",
        ],
      ],
    },
  ],
};

export default docs;
