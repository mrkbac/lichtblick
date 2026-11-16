// SPDX-License-Identifier: MPL-2.0

import { Speaker220Regular } from "@fluentui/react-icons";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const AUDIO_BUTTONS = {
  mute: { id: "audioMute", icon: Speaker220Regular, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
