// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Keys are bound by TabButton from this list (on a focused tab); mouse gestures are display only. */
export const TAB_SHORTCUTS = [
  {
    id: "tab.select",
    titleKey: "tabSelect",
    keys: [{ key: "Enter" }, { key: " " }],
    mouse: [{ action: "click" }],
  },
  {
    id: "tab.rename",
    titleKey: "tabRename",
    keys: [{ key: "F2" }],
    mouse: [{ action: "double-click" }],
  },
  {
    id: "tab.openWhileDragging",
    titleKey: "tabOpenWhileDragging",
    keys: [],
    mouse: [{ action: "hover" }],
  },
  { id: "tab.addToTab", titleKey: "tabAddToTab", keys: [], mouse: [{ action: "drop" }] },
  { id: "tab.addAsTab", titleKey: "tabAddAsTab", keys: [], mouse: [{ action: "drop" }] },
] as const satisfies readonly KeyboardShortcut[];
