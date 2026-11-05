// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { DockviewApi, DockviewPanelApi } from "dockview-react";
import { createContext } from "react";

/** The dockview panel a panel is rendered in. Missing outside a panel layout (stories, tests). */
export const DockPanelContext = createContext<
  { api: DockviewPanelApi; containerApi: DockviewApi } | undefined
>(undefined);
DockPanelContext.displayName = "DockPanelContext";
