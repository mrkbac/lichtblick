// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** The keys are bound by the note editor from this list; the click is handled by its task toggle. */
export const NOTES_SHORTCUTS = [
  {
    id: "notes.finish",
    titleKey: "finishNote",
    keys: [{ key: "Escape" }, { key: "Enter", mod: true }],
  },
  { id: "notes.toggleTask", titleKey: "notesToggleTask", keys: [], mouse: [{ action: "click" }] },
] as const satisfies readonly KeyboardShortcut[];
