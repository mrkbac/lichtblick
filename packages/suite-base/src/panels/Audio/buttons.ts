// SPDX-License-Identifier: MPL-2.0

import VolumeUpOutlinedIcon from "@mui/icons-material/VolumeUpOutlined";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const AUDIO_BUTTONS = {
  mute: { id: "audioMute", icon: VolumeUpOutlinedIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
