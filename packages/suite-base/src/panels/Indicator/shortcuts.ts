// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Display only: handled by the panel's message path drop config. */
export const INDICATOR_SHORTCUTS = [
  { id: "indicator.dropPath", titleKey: "dropMessagePath", keys: [], mouse: [{ action: "drop" }] },
] as const satisfies readonly KeyboardShortcut[];
