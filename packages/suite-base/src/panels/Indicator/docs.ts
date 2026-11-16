// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import VolumeUpIcon from "@mui/icons-material/VolumeUp";

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Shows a colored light and label chosen by rules on one value, with optional alerts.",
  sections: [
    {
      title: "Data",
      items: [
        [
          "Message path",
          "A boolean, number, or string, e.g. /status.level; a message with a data field also works.",
        ],
      ],
    },
    {
      title: "Settings",
      items: [
        ["Style", "Bulb, or color the whole panel background."],
        ["Rules", "Comparison, value, color and label; the first matching rule wins."],
        ["Otherwise", "Color and label when no rule matches."],
        [
          "Alert sound / Notify",
          "Beep, chime, alarm or a browser notification when a rule starts matching.",
        ],
        ["Send test alert", "Rule action that plays the rule's alert now."],
      ],
    },
    {
      title: "Tips",
      items: [
        ["Mute alerts", "Speaker button in the panel silences all of its alerts.", VolumeUpIcon],
        ["No false alarms", "Alerts don't fire on load, after a seek, or after editing a rule."],
      ],
    },
  ],
};
export default docs;
