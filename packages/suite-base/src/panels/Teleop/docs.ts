// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro:
    "Drives a robot by publishing velocity or gamepad commands from on-screen sticks, keyboard, or a gamepad.",
  sections: [
    {
      title: "Data",
      items: [
        [
          "Output",
          "Publishes Twist, TwistStamped, or Joy; needs a data source that supports publishing.",
        ],
        ["Drag and drop", "Drop a topic of the published message type to publish on it."],
      ],
    },
    {
      title: "Settings",
      items: [
        ["Topic / Message type", "Where and what to publish; defaults to /cmd_vel as Twist."],
        ["Publish rate (Hz)", "How often a held command is repeated."],
        ["Stop on release", "Publish a zero command when every control is released."],
        ["Velocity", "Which stick or trigger drives each twist field, and its max value."],
        ["On-screen", "Joystick, two joysticks, D-pad, or hidden."],
        ["Gamepad", "Deadzone plus enable (deadman), turbo, stop, and speed buttons."],
      ],
    },
    {
      title: "Tips",
      items: [
        ["Stop", "Publishes a zero command; release all controls to drive again."],
        ["Speed slider", "Scales all velocities; turbo drives at full max while held."],
        [
          "Gamepad not listed",
          "Browsers only report a gamepad after one of its buttons is pressed.",
        ],
        ["Keyboard", "Drive keys work while the panel is focused."],
      ],
    },
  ],
};
export default docs;
