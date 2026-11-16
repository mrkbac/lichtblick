// SPDX-License-Identifier: MPL-2.0

import CloseIcon from "@mui/icons-material/Close";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

/** Buttons of the shared delta overlay (Plot and State Transitions measure mode). */
export const DELTA_OVERLAY_BUTTONS = {
  removeMarkerA: { id: "deltaOverlayRemoveMarkerA", icon: CloseIcon, placement: "inline" },
  removeMarkerB: { id: "deltaOverlayRemoveMarkerB", icon: CloseIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
