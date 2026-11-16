// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { TAB_BUTTONS } from "./buttons";

const docs: PanelDocs = {
  intro: "Group panels into tabs, each holding its own split layout.",
  buttons: Object.values(TAB_BUTTONS),
  sections: [
    {
      title: "Tabs",
      items: [
        ["Switching", "Every tab stays loaded, so switching is instant."],
        ["Names", "Untitled tabs are named after the panels in them."],
      ],
    },
  ],
};

export default docs;
