// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { TOPIC_HEALTH_BUTTONS } from "./buttons";
import { DEFAULT_CONFIG } from "./health";
import { buildSettingsTree } from "./settings";

const docs: PanelDocs = {
  intro:
    "Check every topic's rate against what you expect and spot slow or stale topics at a glance.",
  buttons: Object.values(TOPIC_HEALTH_BUTTONS),
  settings: () => buildSettingsTree(DEFAULT_CONFIG),
  sections: [
    {
      title: "Table",
      items: [
        ["Status chips", "OK, Slow, Stale and Not measured filter the table to those topics."],
        [
          "Expected",
          "Type an expected rate; leave empty to learn it from the data, 0 disables monitoring. Changed topics appear under Topic overrides in the settings.",
        ],
        [
          "Stale",
          "No message for five expected periods (at least one second), unless a topic override sets another time.",
        ],
        [
          "Not measured",
          "No rate is known for the topic; enable detailed statistics to measure it.",
        ],
      ],
    },
  ],
};

export default docs;
