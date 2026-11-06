// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Display only: handled by the panel's onKeyDown while it has focus. */
export const RAW_MESSAGES_SHORTCUTS = [
  { id: "rawMessages.search", titleKey: "searchMessage", keys: [{ key: "f", mod: true }] },
] as const satisfies readonly KeyboardShortcut[];
