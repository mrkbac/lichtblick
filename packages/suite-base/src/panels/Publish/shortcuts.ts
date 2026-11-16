// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Display only: handled by the message editor. */
export const PUBLISH_SHORTCUTS = [
  { id: "publish.publish", titleKey: "publishMessage", keys: [{ key: "Enter", mod: true }] },
] as const satisfies readonly KeyboardShortcut[];
