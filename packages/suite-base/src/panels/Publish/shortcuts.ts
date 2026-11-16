// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Keys are bound by the panel from this list. Display only: dropping is handled in settings.ts. */
export const PUBLISH_SHORTCUTS = [
  { id: "publish.publish", titleKey: "publishMessage", keys: [{ key: "Enter", mod: true }] },
  { id: "publish.dropTopic", titleKey: "publishDropTopic", keys: [], mouse: [{ action: "drop" }] },
] as const satisfies readonly KeyboardShortcut[];
