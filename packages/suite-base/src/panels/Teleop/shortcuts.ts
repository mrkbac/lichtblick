// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/**
 * Handled by the panel while it has focus and keyboard control is on: stop and speed are bound from
 * this list; drive, turn and turbo keys are display only (KEY_STICKS in twist.ts). Gestures are
 * display only (on-screen controls).
 */
export const TELEOP_SHORTCUTS = [
  {
    id: "teleop.drive",
    titleKey: "teleopDrive",
    keys: [
      { key: "w" },
      { key: "a" },
      { key: "s" },
      { key: "d" },
      { key: "ArrowUp" },
      { key: "ArrowDown" },
      { key: "ArrowLeft" },
      { key: "ArrowRight" },
    ],
    mouse: [{ action: "drag" }],
  },
  {
    id: "teleop.turn",
    titleKey: "teleopTurn",
    keys: [{ key: "q" }, { key: "e" }],
    mouse: [{ action: "drag" }],
  },
  { id: "teleop.turbo", titleKey: "teleopTurbo", keys: [{ key: "Shift" }] },
  { id: "teleop.stop", titleKey: "teleopStop", keys: [{ key: " " }, { key: "Escape" }] },
  { id: "teleop.speed", titleKey: "teleopSpeed", keys: [{ key: "+" }, { key: "=" }, { key: "-" }] },
  {
    id: "teleop.pressButton",
    titleKey: "teleopPressButton",
    keys: [],
    mouse: [{ action: "click" }],
  },
  { id: "teleop.dropTopic", titleKey: "teleopDropTopic", keys: [], mouse: [{ action: "drop" }] },
] as const satisfies readonly KeyboardShortcut[];
