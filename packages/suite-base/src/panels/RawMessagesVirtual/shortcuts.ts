// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/**
 * Search keys are bound by RawMessagesVirtual from this list. Display only: message stepping is
 * handled by handleStepKeyDown (by physical key, since Option+[ types another character on macOS),
 * tree navigation by VirtualizedTree, hovering and dropping by Value and useSharedRawMessagesLogic.
 */
export const RAW_MESSAGES_SHORTCUTS = [
  { id: "rawMessages.search", titleKey: "searchMessage", keys: [{ key: "f", mod: true }] },
  { id: "rawMessages.closeSearch", titleKey: "rawMessagesCloseSearch", keys: [{ key: "Escape" }] },
  {
    id: "rawMessages.previousMessage",
    titleKey: "rawMessagesPreviousMessage",
    keys: [{ key: "[", alt: true }],
  },
  {
    id: "rawMessages.nextMessage",
    titleKey: "rawMessagesNextMessage",
    keys: [{ key: "]", alt: true }],
  },
  {
    id: "rawMessages.moveRow",
    titleKey: "rawMessagesMoveRow",
    keys: [{ key: "ArrowUp" }, { key: "ArrowDown" }],
  },
  {
    id: "rawMessages.firstLastRow",
    titleKey: "rawMessagesFirstLastRow",
    keys: [{ key: "Home" }, { key: "End" }],
  },
  {
    id: "rawMessages.toggleRow",
    titleKey: "rawMessagesToggleRow",
    keys: [{ key: "Enter" }],
    mouse: [{ action: "click" }],
  },
  {
    id: "rawMessages.valueActions",
    titleKey: "rawMessagesValueActions",
    keys: [],
    mouse: [{ action: "hover" }],
  },
  {
    id: "rawMessages.dropPath",
    titleKey: "rawMessagesDropPath",
    keys: [],
    mouse: [{ action: "drop" }],
  },
] as const satisfies readonly KeyboardShortcut[];
