// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Keep Markdown notes and checklists in the layout.",
  sections: [
    {
      title: "Editing",
      items: [
        ["Markdown", "Markdown is highlighted as you type and headings are shown larger."],
        ["Tasks", "Write - [ ] Task; click the box to tick it off."],
        ["Saving", "Notes are saved with the layout as you type."],
      ],
    },
    {
      title: "Settings",
      items: [["Font size", "Text size in px; empty uses the theme default."]],
    },
  ],
};

export default docs;
