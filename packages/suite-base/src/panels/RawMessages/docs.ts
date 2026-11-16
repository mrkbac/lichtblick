// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ChevronRight16Regular } from "@fluentui/react-icons";
import CopyAllIcon from "@mui/icons-material/CopyAll";
import DiffOutlinedIcon from "@mui/icons-material/DifferenceOutlined";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import FilterIcon from "@mui/icons-material/FilterAlt";
import StateTransitionsIcon from "@mui/icons-material/PowerInput";
import SearchIcon from "@mui/icons-material/Search";
import LineChartIcon from "@mui/icons-material/ShowChart";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Inspects the latest message on a topic or message path as an expandable tree.",
  sections: [
    {
      title: "Data",
      items: [
        ["Message path", "Any topic or path, e.g. /odom.pose.pose or /points.fields[0]."],
        ["Filters", "Narrow arrays with filters such as /diagnostics.status[:]{level==2}."],
      ],
    },
    {
      title: "Toolbar",
      items: [
        [
          "Diff",
          "Compare against the previous message or another path, with changes highlighted.",
          DiffOutlinedIcon,
        ],
        ["Expand / collapse all", "Opens or closes every node of the tree.", UnfoldMoreIcon],
        ["Search", "Finds fields and values in the message.", SearchIcon],
        [
          "Step buttons",
          "Jump to the previous or next message on the topic.",
          ChevronRight16Regular,
        ],
      ],
    },
    {
      title: "Hovering a value",
      items: [
        ["Copy", "Copies the value, or the whole message from the header.", CopyAllIcon],
        ["Filter", "Rewrites the path to keep only array items with this value.", FilterIcon],
        ["Plot", "Opens the value in a Plot panel.", LineChartIcon],
        [
          "State transitions",
          "Opens the value in a State Transitions panel.",
          StateTransitionsIcon,
        ],
        ["Drag", "Drag the value onto another panel to use its path there.", DragIndicatorIcon],
      ],
    },
  ],
};

export default docs;
