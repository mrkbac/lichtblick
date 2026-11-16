// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

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
        ["Diff", "Compare against the previous message or another path, with changes highlighted."],
        ["Expand / collapse all", "Opens or closes every node of the tree."],
        ["Search", "Finds fields and values in the message."],
        ["Step buttons", "Jump to the previous or next message on the topic."],
      ],
    },
    {
      title: "Hovering a value",
      items: [
        ["Copy", "Copies the value, or the whole message from the header."],
        ["Filter", "Rewrites the path to keep only array items with this value."],
        ["Plot / State transitions", "Opens the value in a Plot or State Transitions panel."],
        ["Drag", "Drag the value onto another panel to use its path there."],
      ],
    },
  ],
};

export default docs;
