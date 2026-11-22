// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/**
 * Bound by the Topics list while it has focus and one topic selected, so a focused panel that
 * binds the same keys (State Transitions' N) keeps them. Shown on the row's step buttons.
 */
export const TOPIC_LIST_SHORTCUTS = [
  {
    id: "topicList.nextMessage",
    titleKey: "nextTopicMessage",
    keys: [{ key: "n", shift: false, alt: false, mod: false }],
  },
  {
    id: "topicList.previousMessage",
    titleKey: "previousTopicMessage",
    keys: [{ key: "n", shift: true, alt: false, mod: false }],
  },
] as const satisfies readonly KeyboardShortcut[];
