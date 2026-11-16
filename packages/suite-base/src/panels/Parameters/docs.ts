// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import CheckIcon from "@mui/icons-material/Check";
import ClearIcon from "@mui/icons-material/Clear";
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined";
import RestoreIcon from "@mui/icons-material/Restore";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import ViewListIcon from "@mui/icons-material/ViewList";

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Lists the data source's parameters and lets you edit, snapshot and compare them.",
  sections: [
    {
      title: "Toolbar",
      items: [
        ["Filter", "Narrow the list by name, optionally with a regular expression."],
        ["Flat list", "Toggles between a namespace tree and a flat list.", ViewListIcon],
        ["Expand all", "Opens every namespace in the tree.", UnfoldMoreIcon],
        ["Collapse all", "Closes every namespace in the tree.", UnfoldLessIcon],
        ["Snapshots", "Save, import or export parameters as YAML.", PhotoCameraOutlinedIcon],
      ],
    },
    {
      title: "Editing",
      items: [
        ["Edit a value", "Booleans are switches; numbers and strings are typed in place."],
        ["Lists and dicts", "Edited as JSON."],
        ["Submit", "Sets the edited value; Enter does the same.", CheckIcon],
        ["Reset", "Discards the edit; Esc does the same.", ClearIcon],
        ["Read-only", "Values can only be changed if the data source supports setting them."],
      ],
    },
    {
      title: "Comparing",
      items: [
        ["Pick a snapshot", "Shows changed, added and removed parameters against it."],
        ["Only differences", "Hides parameters that match the snapshot."],
        ["Restore value", "Sets one parameter back to its snapshot value.", RestoreIcon],
        ["Restore selected", "Sets the checked parameters back to their snapshot values."],
        ["Stop comparing", "Closes the comparison.", ClearIcon],
      ],
    },
  ],
};

export default docs;
