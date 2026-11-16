// SPDX-License-Identifier: MPL-2.0

import {
  ChevronLeft20Regular,
  ChevronRight20Regular,
  Dismiss12Regular,
  PointScan20Regular,
} from "@fluentui/react-icons";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";
import { shortcutById } from "@lichtblick/suite-base/util/keyboardShortcuts";

import { STATE_TRANSITIONS_SHORTCUTS } from "./shortcuts";

export const STATE_TRANSITIONS_BUTTONS = {
  previousMatch: {
    id: "stateTransitionsPreviousMatch",
    icon: ChevronLeft20Regular,
    placement: "toolbar",
    shortcut: shortcutById(STATE_TRANSITIONS_SHORTCUTS, "stateTransitions.previous"),
  },
  nextMatch: {
    id: "stateTransitionsNextMatch",
    icon: ChevronRight20Regular,
    placement: "toolbar",
    shortcut: shortcutById(STATE_TRANSITIONS_SHORTCUTS, "stateTransitions.next"),
  },
  measure: { id: "stateTransitionsMeasure", icon: PointScan20Regular, placement: "toolbar" },
  deleteSeries: { id: "stateTransitionsDeleteSeries", icon: Dismiss12Regular, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
