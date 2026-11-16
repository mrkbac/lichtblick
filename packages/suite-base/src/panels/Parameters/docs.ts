// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Lists the data source's parameters and lets you edit, snapshot and compare them.",
  sections: [
    {
      title: "Toolbar",
      items: [
        ["Filter", "Narrow the list by name, optionally with a regular expression."],
        ["Group by namespace", "Toggle between a namespace tree and a flat list."],
        ["Snapshots", "Save, import or export parameters as YAML."],
      ],
    },
    {
      title: "Editing",
      items: [
        ["Edit a value", "Booleans are switches; numbers and strings are typed in place."],
        ["Lists and dicts", "Edited as JSON."],
        ["Enter / Esc", "Submit or reset the value being edited."],
        ["Read-only", "Values can only be changed if the data source supports setting them."],
      ],
    },
    {
      title: "Comparing",
      items: [
        ["Pick a snapshot", "Shows changed, added and removed parameters against it."],
        ["Only differences", "Hides parameters that match the snapshot."],
        ["Restore", "Sets the selected parameters back to their snapshot values."],
      ],
    },
  ],
};

export default docs;
