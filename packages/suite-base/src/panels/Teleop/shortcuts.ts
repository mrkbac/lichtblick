// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Display only: handled by the panel while it has focus and keyboard control is on. */
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
  },
  { id: "teleop.turn", titleKey: "teleopTurn", keys: [{ key: "q" }, { key: "e" }] },
  { id: "teleop.turbo", titleKey: "teleopTurbo", keys: [{ key: "Shift" }] },
  { id: "teleop.stop", titleKey: "teleopStop", keys: [{ key: " " }, { key: "Escape" }] },
  { id: "teleop.speed", titleKey: "teleopSpeed", keys: [{ key: "+" }, { key: "-" }] },
] as const satisfies readonly KeyboardShortcut[];
