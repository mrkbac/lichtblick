// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Bound by the panel from this list. */
export const STATE_TRANSITIONS_SHORTCUTS = [
  {
    id: "stateTransitions.next",
    titleKey: "nextMatch",
    keys: [{ key: "n", shift: false, alt: false }],
  },
  {
    id: "stateTransitions.previous",
    titleKey: "previousMatch",
    keys: [{ key: "n", shift: true, alt: false }],
  },
  { id: "stateTransitions.exitMeasure", titleKey: "exitMeasureMode", keys: [{ key: "Escape" }] },
] as const satisfies readonly KeyboardShortcut[];
