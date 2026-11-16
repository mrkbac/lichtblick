// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Display only: handled by LogList and SeverityTimeline. */
export const LOG_SHORTCUTS = [
  { id: "log.seekToMessage", titleKey: "logSeekToMessage", keys: [], mouse: [{ action: "click" }] },
  {
    id: "log.seekToProblem",
    titleKey: "logSeekToProblem",
    keys: [],
    mouse: [{ action: "click" }],
  },
] as const satisfies readonly KeyboardShortcut[];
