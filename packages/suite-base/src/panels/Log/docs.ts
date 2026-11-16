// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

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
        ["Match case / regex", "Toolbar toggles for case-sensitive or regular-expression terms."],
        ["Previous / next", "Jump to the previous or next warning or error."],
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
        ["Copy", "Copy one message, or all filtered messages from the toolbar."],
        ["Follow playhead", "Scrolling away stops following; the arrow button resumes it."],
      ],
    },
  ],
};

export default docs;
