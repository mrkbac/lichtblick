// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Group panels into tabs, each holding its own split layout.",
  sections: [
    {
      title: "Interactions",
      items: [
        ["Click a tab", "Shows it; every tab stays loaded, so switching is instant."],
        ["Double-click a tab", "Renames it; untitled tabs are named after their panels."],
        ["Drop on the tab strip", "Adds the dragged panel as a new tab."],
        ["Drop on a tab", "Adds the panel to that tab's layout; resting on a tab opens it first."],
        [
          "Close a tab",
          "Removes it and its panels. With one tab left, the tab panel is replaced by its contents.",
        ],
      ],
    },
  ],
};

export default docs;
