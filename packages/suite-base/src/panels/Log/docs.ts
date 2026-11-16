// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { sharedI18nObject } from "@lichtblick/suite-base/i18n";

import { LOG_BUTTONS } from "./buttons";
import { SUPPORTED_DATATYPES } from "./conversion";
import { buildSettingsTree, defaultConfig } from "./settings";

const docs: PanelDocs = {
  intro: "Shows log messages from all log topics, synced to the playhead.",
  schemas: SUPPORTED_DATATYPES,
  buttons: Object.values(LOG_BUTTONS),
  settings: () => buildSettingsTree(defaultConfig, [], [], sharedI18nObject.getFixedT(null, "log")),
  sections: [
    {
      title: "Search",
      items: [
        ["Terms", "Rows matching any term in the message or node name are shown."],
        ["-term", "Hides rows that match the term."],
      ],
    },
  ],
};

export default docs;
