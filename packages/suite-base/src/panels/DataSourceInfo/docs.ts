// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { SOURCE_INFO_BUTTONS } from "./buttons";

const docs: PanelDocs = {
  intro:
    "Inspect the open recording or live source: topics, timing, files, channels, schemas and metadata.",
  buttons: Object.values(SOURCE_INFO_BUTTONS),
  sections: [
    {
      title: "Topics & timing",
      items: [
        [
          "Scan",
          "Reads messages to measure activity, frequency, jitter, size and the largest interval.",
        ],
        ["List / Tree", "Show topics flat or grouped by namespace with totals."],
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
