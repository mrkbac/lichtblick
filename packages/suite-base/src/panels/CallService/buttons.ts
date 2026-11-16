// SPDX-License-Identifier: MPL-2.0

import ReplayIcon from "@mui/icons-material/Replay";
import UndoIcon from "@mui/icons-material/Undo";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const CALL_SERVICE_BUTTONS = {
  restoreRequest: { id: "callServiceRestoreRequest", icon: UndoIcon, placement: "inline" },
  rerun: { id: "callServiceRerun", icon: ReplayIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
