// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Shows how discrete values, like states or modes, change over time as colored bars.",
  sections: [
    {
      title: "Data",
      items: [
        [
          "Message path",
          "One value per message, e.g. /robot_state.mode; each distinct value gets a color.",
        ],
        ["Drag and drop", "Drop a field from the topic list to add it as a series."],
      ],
    },
    {
      title: "Settings",
      items: [
        [
          "Condition",
          'Optional comparison like > 2 or == "ERROR"; the series shows when it is true.',
        ],
        ["Timestamp", "Receive time or header stamp."],
        ["Sync with other plots", "Zoom and pan together with synced plots."],
        ["X Axis › Range (seconds)", "Show only the last N seconds up to the playhead."],
      ],
    },
    {
      title: "Mouse",
      items: [
        ["Click", "Seek to that time; in measure mode, places the P1/P2 markers."],
        ["Wheel / Drag", "Zoom and pan the time axis."],
        ["Legend", "Drag a series onto another panel to add it there."],
      ],
    },
    {
      title: "Tips",
      items: [["Match navigation", "With a condition set, the toolbar steps between matches."]],
    },
  ],
};
export default docs;
