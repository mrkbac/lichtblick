// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Shows one numeric value as a colored arc gauge or a roll/pitch inclinometer.",
  sections: [
    {
      title: "Data",
      items: [
        [
          "Message path",
          "Any single number, e.g. /battery.percentage; drop a field from the topic list to set it.",
        ],
      ],
    },
    {
      title: "Settings",
      items: [
        ["Display mode", "Arc for a value in a range, Roll or Pitch for a tilt angle."],
        ["Min / Max", "Arc range; values outside are clamped."],
        ["Color mode", "A color map or a custom gradient; Reverse flips it."],
        ["Input angle unit", "Roll/Pitch: whether the value is in degrees or radians."],
        [
          "Warning / Critical angle (°)",
          "Roll/Pitch: angles where the indicator turns warning or critical.",
        ],
        ["Angle range (±°)", "Roll/Pitch: largest angle shown, at most 90°."],
      ],
    },
  ],
};
export default docs;
