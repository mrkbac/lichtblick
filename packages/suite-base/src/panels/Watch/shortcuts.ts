// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/**
 * Open in Plot and cancel edit are bound from here by WatchRowView. The rest is display only:
 * Enter handling (IME, autocomplete) lives in index.tsx and PathEditor, paste in index.tsx, drags in
 * WatchRowView/WatchTree.
 */
export const WATCH_SHORTCUTS = [
  {
    id: "watch.openInPlot",
    titleKey: "watchOpenInPlot",
    keys: [{ key: "Enter" }, { key: " " }],
    mouse: [{ action: "click" }],
  },
  { id: "watch.addPath", titleKey: "watchAddPath", keys: [{ key: "Enter", shift: false }] },
  {
    id: "watch.addAllFields",
    titleKey: "watchAddAllFields",
    keys: [{ key: "Enter", shift: true }],
    mouse: [{ action: "click", shift: true }],
  },
  { id: "watch.cancelEdit", titleKey: "watchCancelEdit", keys: [{ key: "Escape" }] },
  { id: "watch.pastePaths", titleKey: "watchPastePaths", keys: [{ key: "v", mod: true }] },
  { id: "watch.reorderRow", titleKey: "watchReorderRow", keys: [], mouse: [{ action: "drag" }] },
  { id: "watch.dropFields", titleKey: "watchDropFields", keys: [], mouse: [{ action: "drop" }] },
] as const satisfies readonly KeyboardShortcut[];
