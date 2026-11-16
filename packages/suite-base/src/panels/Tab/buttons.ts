// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import CloseIcon from "@mui/icons-material/Close";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const TAB_BUTTONS = {
  close: { id: "tabClose", icon: CloseIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
