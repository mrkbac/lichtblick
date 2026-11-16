// SPDX-License-Identifier: MPL-2.0

import VolumeUpIcon from "@mui/icons-material/VolumeUp";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

function MuteIcon(): React.JSX.Element {
  return <VolumeUpIcon fontSize="small" />;
}

export const INDICATOR_BUTTONS = {
  muteAlerts: { id: "indicatorMuteAlerts", icon: MuteIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
