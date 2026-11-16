// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { INDICATOR_BUTTONS } from "./buttons";
import { DEFAULT_CONFIG } from "./constants";
import { buildSettingsTree } from "./settings";

const docs: PanelDocs = {
  intro: "Shows a colored light and label chosen by rules on one value, with optional alerts.",
  buttons: Object.values(INDICATOR_BUTTONS),
  // The example rule has an alert, so its alert fields and test action are listed too.
  settings: () =>
    buildSettingsTree(
      {
        ...DEFAULT_CONFIG,
        rules: DEFAULT_CONFIG.rules.map((rule) => ({ ...rule, alertSound: "beep" as const })),
      },
      undefined,
      undefined,
      "default",
    ),
  sections: [
    {
      title: "Alerts",
      items: [
        ["No false alarms", "Alerts don't fire on load, after a seek, or after editing a rule."],
      ],
    },
  ],
};
export default docs;
