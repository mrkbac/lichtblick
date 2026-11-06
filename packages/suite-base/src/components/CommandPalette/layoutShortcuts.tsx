// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useMemo } from "react";

import KeyListener from "@lichtblick/suite-base/components/KeyListener";
import {
  CurrentLayoutActions,
  useCurrentLayoutActions,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { formatKeyboardShortcut } from "@lichtblick/suite-base/util/formatKeyboardShortcut";
import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";

export type LayoutShortcut = {
  /** Command palette id. */
  id: string;
  /** Key in the commandPalette i18n namespace. */
  titleKey: "undoLayoutChange" | "redoLayoutChange" | "reopenClosedPanel";
  /** Shortcut as shown to the user, undefined when this build has none. */
  shortcut: () => string | undefined;
  matches: (event: KeyboardEvent) => boolean;
  run: (actions: CurrentLayoutActions) => void;
};

const mod = (event: KeyboardEvent) => event.metaKey || event.ctrlKey;
const key = (event: KeyboardEvent, letter: string) => event.key.toLowerCase() === letter;

/**
 * Layout editing shortcuts. They are ignored while typing in a text field or code editor, so those
 * keep their native undo.
 */
export const LAYOUT_SHORTCUTS: readonly LayoutShortcut[] = [
  {
    id: "layout.undo",
    titleKey: "undoLayoutChange",
    shortcut: () => formatKeyboardShortcut("Z", ["Meta"]),
    matches: (event) => mod(event) && !event.shiftKey && key(event, "z"),
    run: (actions) => {
      actions.undoLayoutChange();
    },
  },
  {
    id: "layout.redo",
    titleKey: "redoLayoutChange",
    shortcut: () => formatKeyboardShortcut("Z", ["Meta", "Shift"]),
    matches: (event) =>
      (mod(event) && event.shiftKey && key(event, "z")) ||
      (event.ctrlKey && !event.shiftKey && key(event, "y")),
    run: (actions) => {
      actions.redoLayoutChange();
    },
  },
  {
    id: "layout.reopen-panel",
    titleKey: "reopenClosedPanel",
    // Browsers keep Cmd/Ctrl+Shift+T for reopening tabs, so only the desktop app binds it.
    shortcut: () => (isDesktopApp() ? formatKeyboardShortcut("T", ["Meta", "Shift"]) : undefined),
    matches: (event) => isDesktopApp() && mod(event) && event.shiftKey && key(event, "t"),
    run: (actions) => {
      actions.reopenClosedPanel();
    },
  },
];

/** Binds {@link LAYOUT_SHORTCUTS} globally. */
export function LayoutShortcutListener(): React.JSX.Element {
  const actions = useCurrentLayoutActions();
  const handlers = useMemo(() => {
    const handler = (event: KeyboardEvent) => {
      const shortcut = LAYOUT_SHORTCUTS.find((s) => s.matches(event));
      if (shortcut == undefined) {
        return false; // keep the browser default
      }
      shortcut.run(actions);
      return true;
    };
    return { z: handler, y: handler, t: handler };
  }, [actions]);
  return <KeyListener global keyDownHandlers={handlers} />;
}
