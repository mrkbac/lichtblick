// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  Delete20Regular,
  DocumentOnePageSparkle24Regular,
  Edit20Regular,
  Script24Regular,
  Toolbox24Regular,
} from "@fluentui/react-icons";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Write TypeScript scripts that transform input topics into new output topics.",
  sections: [
    {
      title: "Scripts",
      items: [
        ["Scripts", "Lists your scripts; click one to edit it.", Script24Regular],
        ["New script", "Creates an empty script.", AddIcon],
        ["Rename", "Renames the script.", Edit20Regular],
        ["Delete", "Deletes the script.", Delete20Regular],
        ["Templates", "Start from an example script.", DocumentOnePageSparkle24Regular],
        ["Utilities", "Read-only helpers you can import, e.g. ./pointClouds.ts.", Toolbox24Regular],
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
        ["Go to definition", "Opens library types read-only."],
        ["Go back", "Returns to the script you came from.", ArrowBackIcon],
        ["Auto-format on save", "Setting: format the code with Prettier when saving."],
      ],
    },
  ],
};

export default docs;
