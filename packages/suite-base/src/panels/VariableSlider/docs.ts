// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { buildSettingsTree, defaultConfig } from "./settings";

const docs: PanelDocs = {
  intro: "Set a numeric layout variable with a slider.",
  settings: () => buildSettingsTree(defaultConfig),
  sections: [
    {
      title: "Tips",
      items: [
        [
          "Using it",
          "Reference the variable in message paths, e.g. /topic.items[$globalVariable].",
        ],
      ],
    },
  ],
};

export default docs;
