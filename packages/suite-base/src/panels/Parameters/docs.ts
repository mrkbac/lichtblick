// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { PARAMETERS_BUTTONS } from "./buttons";

const docs: PanelDocs = {
  intro: "Lists the data source's parameters and lets you edit, snapshot and compare them.",
  buttons: Object.values(PARAMETERS_BUTTONS),
  sections: [
    {
      title: "Editing",
      items: [
        ["Edit a value", "Booleans are switches; numbers and strings are typed in place."],
        ["Lists and dicts", "Edited as JSON."],
        ["Read-only", "Values can only be changed if the data source supports setting them."],
      ],
    },
    {
      title: "Comparing",
      items: [
        ["Pick a snapshot", "Shows changed, added and removed parameters against it."],
        ["Only differences", "Hides parameters that match the snapshot."],
        ["Restore selected", "Sets the checked parameters back to their snapshot values."],
      ],
    },
  ],
};

export default docs;
