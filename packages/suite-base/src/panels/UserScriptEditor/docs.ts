// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { USER_SCRIPTS_BUTTONS } from "./buttons";
import { buildSettingsTree, defaultConfig } from "./settings";

const docs: PanelDocs = {
  intro: "Write TypeScript scripts that transform input topics into new output topics.",
  buttons: Object.values(USER_SCRIPTS_BUTTONS),
  settings: () => buildSettingsTree(defaultConfig),
  sections: [
    {
      title: "Scripts",
      items: [
        ["Utilities", "Import them by relative path, e.g. ./pointClouds.ts."],
        [
          "Inputs / output",
          "Export inputs (topics to read) and output, e.g. /studio_script/my_topic, usable in any panel.",
        ],
      ],
    },
    {
      title: "Editor",
      items: [
        ["Save", "Runs the new code; leaving the panel saves too."],
        ["Alerts / Logs", "Compile errors, and output from log() calls in your script."],
        ["Go to definition", "Opens library types read-only."],
      ],
    },
  ],
};

export default docs;
