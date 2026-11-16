// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Write TypeScript scripts that transform input topics into new output topics.",
  sections: [
    {
      title: "Scripts",
      items: [
        ["Scripts", "Create, rename, delete and switch scripts in the sidebar."],
        ["Templates", "Start from an example script."],
        ["Utilities", "Read-only helpers you can import, e.g. ./pointClouds.ts."],
        [
          "Inputs / output",
          "Export inputs (topics to read) and output, e.g. /studio_script/my_topic, usable in any panel.",
        ],
      ],
    },
    {
      title: "Editor",
      items: [
        ["Save", "Ctrl/Cmd + S or the Save button runs the new code; leaving the panel saves too."],
        ["Alerts / Logs", "Compile errors, and output from log() calls in your script."],
        ["Go to definition", "Opens library types read-only; the back arrow returns."],
        ["Auto-format on save", "Setting: format the code with Prettier when saving."],
      ],
    },
  ],
};

export default docs;
