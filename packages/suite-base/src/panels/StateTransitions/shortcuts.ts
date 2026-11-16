// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Keys are bound by the panel from this list; mouse gestures are display only (chart and legend). */
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
  {
    id: "stateTransitions.seek",
    titleKey: "stateTransitionsSeek",
    keys: [],
    mouse: [{ action: "click" }],
  },
  {
    id: "stateTransitions.placeMarker",
    titleKey: "stateTransitionsPlaceMarker",
    keys: [],
    mouse: [{ action: "click" }],
  },
  {
    id: "stateTransitions.zoom",
    titleKey: "stateTransitionsZoom",
    keys: [],
    mouse: [{ action: "scroll" }],
  },
  {
    id: "stateTransitions.pan",
    titleKey: "stateTransitionsPan",
    keys: [],
    mouse: [{ action: "drag" }],
  },
  {
    id: "stateTransitions.editSeries",
    titleKey: "stateTransitionsEditSeries",
    keys: [],
    mouse: [{ action: "click" }],
  },
  {
    id: "stateTransitions.copySeries",
    titleKey: "stateTransitionsCopySeries",
    keys: [],
    mouse: [{ action: "drag" }],
  },
  {
    id: "stateTransitions.dropPath",
    titleKey: "stateTransitionsDropPath",
    keys: [],
    mouse: [{ action: "drop" }],
  },
] as const satisfies readonly KeyboardShortcut[];
