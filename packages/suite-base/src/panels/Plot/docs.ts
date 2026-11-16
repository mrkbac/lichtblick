// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro:
    "Plots numeric values from any message path over time, against an index, or against another path.",
  sections: [
    {
      title: "Data",
      items: [
        ["Message path", "Any numeric field, e.g. /odom.pose.pose.position.x."],
        ["Reference line", "A fixed value drawn as a horizontal or vertical line."],
        ["Timestamp", "Receive time, header stamp, or a custom field of the same message."],
      ],
    },
    {
      title: "Settings",
      items: [
        ["X Axis › Value", "Timestamp, index, or another message path (current or accumulated)."],
        ["Display", "Time series, frequency spectrum (FFT), or histogram of each series."],
        ["Moving average (samples)", "Smooths a series over the last N samples."],
        ["Y Axis › Range", "Fit visible data, or hold the max range seen so far."],
        ["Sync with other plots", "Zoom and pan all synced plots together."],
      ],
    },
    {
      title: "Mouse",
      items: [
        ["Wheel", "Zoom; Shift zooms only Y, Alt/Option only X."],
        ["Drag", "Pan the plot."],
        ["Click", "Seek playback to that time (timestamp plots)."],
        ["Double-click", "Reset view."],
        [
          "Legend",
          "Click a series to open its settings; drag it onto another panel to add it there.",
        ],
        ["Right-click", "Copy values at cursor, download CSV, or save as PNG."],
      ],
    },
    {
      title: "Tips",
      items: [
        ["Measure delta", "Toolbar button that places P1/P2 markers and shows range statistics."],
      ],
    },
  ],
};
export default docs;
