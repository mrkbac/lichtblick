// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { sharedI18nObject } from "@lichtblick/suite-base/i18n";

import { DIAGNOSTIC_SUMMARY_BUTTONS } from "./buttons";
import { ALLOWED_DATATYPES, DEFAULT_CONFIG } from "./constants";
import { buildSettingsTree } from "./utils/buildSettingsTree";

const docs: PanelDocs = {
  intro: "Lists every diagnostic check with its current level, worst first.",
  schemas: ALLOWED_DATATYPES,
  buttons: Object.values(DIAGNOSTIC_SUMMARY_BUTTONS),
  settings: () =>
    buildSettingsTree(
      DEFAULT_CONFIG,
      { available: [], selected: [], subscribed: [] },
      sharedI18nObject.getFixedT(null, "diagnostics"),
    ),
  sections: [
    {
      title: "Toolbar",
      items: [
        ["Level", "Hides checks below the chosen level (OK, WARN, ERROR, STALE)."],
        ["Filter", "Fuzzy-matches hardware ID and check name."],
      ],
    },
  ],
};

export default docs;
