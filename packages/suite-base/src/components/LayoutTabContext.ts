// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { createContext } from "react";

/**
 * The Tab panels a panel layout is nested in, outermost first; the last one owns the layout.
 * Empty for the root layout.
 */
export const LayoutTabContext = createContext<readonly string[]>([]);
LayoutTabContext.displayName = "LayoutTabContext";
