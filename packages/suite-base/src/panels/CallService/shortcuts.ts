// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Bound by the panel's onKeyDown. */
export const CALL_SERVICE_SHORTCUTS = [
  { id: "callService.call", titleKey: "callService", keys: [{ key: "Enter", mod: true }] },
] as const satisfies readonly KeyboardShortcut[];
