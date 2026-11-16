// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import type { DocumentedNodes } from "@lichtblick/suite-base/panels/shared/documentedSettings";

import { buildSettingsTreeTeleop } from "./buildSettingsTree";
import { TELEOP_BUTTONS } from "./buttons";
import { DEFAULT_CONFIG } from "./constants";

/** Settings of the Twist default plus the ones shown only for Joy output (e.g. frame ID). */
function allSettings(): DocumentedNodes {
  const twist = buildSettingsTreeTeleop(DEFAULT_CONFIG, []);
  const joy = buildSettingsTreeTeleop({ ...DEFAULT_CONFIG, messageType: "Joy" }, []);
  const merged: DocumentedNodes = {};
  for (const key of new Set([...Object.keys(twist), ...Object.keys(joy)])) {
    const node = twist[key] ?? joy[key];
    // Joy first so its extra fields keep their place in the order
    merged[key] = node && { ...node, fields: { ...joy[key]?.fields, ...twist[key]?.fields } };
  }
  return merged;
}

const docs: PanelDocs = {
  intro:
    "Drives a robot by publishing velocity or gamepad commands from on-screen sticks, keyboard, or a gamepad.",
  buttons: Object.values(TELEOP_BUTTONS),
  settings: allSettings,
  sections: [
    {
      title: "Data",
      items: [
        [
          "Output",
          "Publishes Twist, TwistStamped, or Joy; needs a data source that supports publishing.",
        ],
      ],
    },
    {
      title: "Tips",
      items: [
        ["Speed slider", "Scales all velocities; turbo drives at full max while held."],
        ["Keyboard", "Drive keys work only while the panel itself is focused."],
      ],
    },
  ],
};
export default docs;
