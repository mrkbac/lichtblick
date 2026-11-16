// SPDX-License-Identifier: MPL-2.0

import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const TAB_BUTTONS = {
  add: { id: "tabAdd", icon: AddIcon, placement: "toolbar" },
  close: { id: "tabClose", icon: CloseIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
