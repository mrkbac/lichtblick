// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { sharedI18nObject } from "@lichtblick/suite-base/i18n";

import { WATCH_BUTTONS } from "./buttons";
import { DEFAULT_CONFIG, newRow } from "./config";
import { buildSettingsTree } from "./settings";

const docs: PanelDocs = {
  intro: "Watch many values side by side, each with its age, a sparkline and change highlighting.",
  buttons: Object.values(WATCH_BUTTONS),
  // One example row, so the per-row fields are listed too.
  settings: () =>
    buildSettingsTree(
      { ...DEFAULT_CONFIG, rows: [newRow("Value")] },
      new Map(),
      sharedI18nObject.getFixedT(null, "watch"),
    ),
  sections: [
    {
      title: "Data",
      items: [
        [
          "Message paths",
          "Any path, with filters and math modifiers, e.g. /odom.twist.twist.linear.x.@mul(3.6).",
        ],
        ["Messages", "A path to a whole message can be expanded to show its fields as a tree."],
      ],
    },
  ],
};

export default docs;
