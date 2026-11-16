// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import InsightsIcon from "@mui/icons-material/Insights";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const TOPIC_HEALTH_BUTTONS = {
  detailedStats: { id: "topicHealthDetailedStats", icon: InsightsIcon, placement: "inline" },
  openInRawMessages: {
    id: "topicHealthOpenInRawMessages",
    icon: OpenInNewIcon,
    placement: "inline",
  },
} as const satisfies Record<string, PanelButton>;
