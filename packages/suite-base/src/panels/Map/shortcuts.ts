// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Display only: handled by MapToolbar while a drawing tool is active. */
export const MAP_SHORTCUTS = [
  { id: "map.finish", titleKey: "finishDrawing", keys: [{ key: "Enter" }] },
  { id: "map.cancel", titleKey: "cancelDrawing", keys: [{ key: "Escape" }] },
  {
    id: "map.deletePoint",
    titleKey: "deleteDrawingPoint",
    keys: [{ key: "Backspace" }, { key: "Delete" }],
  },
] as const satisfies readonly KeyboardShortcut[];
