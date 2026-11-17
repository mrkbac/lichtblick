// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import AddIcon from "@mui/icons-material/Add";
import ViewAgendaOutlinedIcon from "@mui/icons-material/ViewAgendaOutlined";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const STACK_BUTTONS = {
  layout: { id: "stackLayout", icon: ViewAgendaOutlinedIcon, placement: "toolbar" },
  add: { id: "stackAdd", icon: AddIcon, placement: "toolbar" },
} as const satisfies Record<string, PanelButton>;
