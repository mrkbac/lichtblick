// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  ArrowDown16Regular,
  ArrowUp16Regular,
  Copy16Regular,
  Copy20Filled,
  TextCaseTitle16Regular,
} from "@fluentui/react-icons";

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { SUPPORTED_DATATYPES } from "./conversion";

const docs: PanelDocs = {
  intro: "Shows log messages from all log topics, synced to the playhead.",
  schemas: SUPPORTED_DATATYPES,
  sections: [
    {
      title: "Search",
      items: [
        ["Terms", "Rows matching any term in the message or node name are shown."],
        ["-term", "Hides rows that match the term."],
        ["Match case", "Makes terms case-sensitive.", TextCaseTitle16Regular],
        [".* Regex", "Treats terms as regular expressions."],
        ["Previous problem", "Jumps to the previous warning or error.", ArrowUp16Regular],
        ["Next problem", "Jumps to the next warning or error.", ArrowDown16Regular],
        ["Copy logs", "Copies all messages that pass the filters.", Copy20Filled],
      ],
    },
    {
      title: "Settings",
      items: [
        ["Log level", "Hide messages below the chosen severity."],
        ["Topics", "Show or hide each log topic."],
        ["Namespaces", "Show or hide messages per node name."],
      ],
    },
    {
      title: "Mouse",
      items: [
        ["Click a row", "Seeks playback to that message."],
        ["Severity strip", "Shows where warnings and errors occur; click to seek."],
        ["Copy a message", "Hover a row and click its copy button.", Copy16Regular],
        ["Follow playhead", "Scrolling away stops following; the arrow button resumes it."],
      ],
    },
  ],
};

export default docs;
