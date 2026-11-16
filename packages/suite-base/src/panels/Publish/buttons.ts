// SPDX-License-Identifier: MPL-2.0

import RepeatIcon from "@mui/icons-material/Repeat";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const PUBLISH_BUTTONS = {
  repeat: { id: "publishRepeat", icon: RepeatIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
