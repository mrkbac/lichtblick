// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

function StopLabel(): React.JSX.Element {
  return <>Stop</>;
}

export const TELEOP_BUTTONS = {
  stop: { id: "teleopStop", icon: StopLabel, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
