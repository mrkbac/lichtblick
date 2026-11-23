// SPDX-License-Identifier: MPL-2.0

import CenterFocusWeakIcon from "@mui/icons-material/CenterFocusWeak";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";
import { shortcutById } from "@lichtblick/suite-base/util/keyboardShortcuts";

import { STATE_TRANSITIONS_SHORTCUTS } from "./shortcuts";

export const STATE_TRANSITIONS_BUTTONS = {
  previousMatch: {
    id: "stateTransitionsPreviousMatch",
    icon: ChevronLeftIcon,
    placement: "toolbar",
    shortcut: shortcutById(STATE_TRANSITIONS_SHORTCUTS, "stateTransitions.previous"),
  },
  nextMatch: {
    id: "stateTransitionsNextMatch",
    icon: ChevronRightIcon,
    placement: "toolbar",
    shortcut: shortcutById(STATE_TRANSITIONS_SHORTCUTS, "stateTransitions.next"),
  },
  measure: { id: "stateTransitionsMeasure", icon: CenterFocusWeakIcon, placement: "toolbar" },
  deleteSeries: { id: "stateTransitionsDeleteSeries", icon: CloseIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
