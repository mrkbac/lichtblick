// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Display only: handled by Table, TableCell and the panel's message path drop config. */
export const TABLE_SHORTCUTS = [
  { id: "table.sort", titleKey: "tableSort", keys: [], mouse: [{ action: "click" }] },
  { id: "table.expandCell", titleKey: "tableExpandCell", keys: [], mouse: [{ action: "click" }] },
  { id: "table.dropPath", titleKey: "tableDropPath", keys: [], mouse: [{ action: "drop" }] },
] as const satisfies readonly KeyboardShortcut[];
