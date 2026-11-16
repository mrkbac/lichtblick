// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { sharedI18nObject } from "@lichtblick/suite-base/i18n";

import { buildSettingsTree, defaultConfig } from "./settings";

const docs: PanelDocs = {
  intro: "Keep Markdown notes and checklists in the layout.",
  settings: () => buildSettingsTree(defaultConfig, sharedI18nObject.getFixedT(null, "notes")),
  sections: [
    {
      title: "Editing",
      items: [
        ["Markdown", "Markdown is highlighted as you type and headings are shown larger."],
        ["Tasks", "Write - [ ] Task to add a checkbox you can tick off."],
        ["Saving", "Notes are saved with the layout as you type."],
      ],
    },
  ],
};

export default docs;
