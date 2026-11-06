// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { keyboardShortcuts } from "@lichtblick/suite-base/i18n/en/keyboardShortcuts";
import {
  formatKeyboardShortcut,
  ModifierKeys,
} from "@lichtblick/suite-base/util/formatKeyboardShortcut";

export type KeyboardShortcutTitleKey = keyof typeof keyboardShortcuts;

/** One key binding. */
export type KeyCombo = {
  /** `KeyboardEvent.key`, compared case-insensitively ("k", "ArrowLeft", " ", "?"). */
  key: string;
  /** Cmd on macOS, Ctrl elsewhere (either is accepted). Without it, neither may be held. */
  mod?: boolean;
  /** Required state of Shift; left out means either. */
  shift?: boolean;
  /** Required state of Alt/Option; left out means either. */
  alt?: boolean;
};

/**
 * A keyboard shortcut, declared once. The same declaration feeds the shortcut overlay and, via
 * {@link shortcutKeyHandlers} or {@link findShortcut}, the key handling itself, so the two can't
 * drift apart. Shortcuts handled elsewhere (e.g. by a 3D renderable) are declared for display only.
 */
export type KeyboardShortcut = {
  id: string;
  /** Key in the keyboardShortcuts i18n namespace. */
  titleKey: KeyboardShortcutTitleKey;
  /** Alternative bindings, all shown in the overlay. */
  keys: readonly KeyCombo[];
};

/** The parts of a DOM or React keyboard event that shortcuts look at. */
export type KeyEventLike = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

export function matchesCombo(event: KeyEventLike, combo: KeyCombo): boolean {
  return (
    event.key.toLowerCase() === combo.key.toLowerCase() &&
    (event.metaKey || event.ctrlKey) === (combo.mod ?? false) &&
    (combo.shift == undefined || event.shiftKey === combo.shift) &&
    (combo.alt == undefined || event.altKey === combo.alt)
  );
}

/** The first shortcut with a binding matching the event. */
export function findShortcut<S extends KeyboardShortcut>(
  shortcuts: readonly S[],
  event: KeyEventLike,
): S | undefined {
  return shortcuts.find((shortcut) => shortcut.keys.some((combo) => matchesCombo(event, combo)));
}

/** Runs a shortcut. Return false to keep the browser default (KeyListener contract). */
export type ShortcutRunner = (event: KeyboardEvent) => boolean | void;

/**
 * Builds KeyListener handlers from shortcut declarations. Keys without a matching declared
 * binding (e.g. Cmd+R where only R is declared) keep their default.
 */
export function shortcutKeyHandlers<S extends KeyboardShortcut>(
  shortcuts: readonly S[],
  runners: Partial<Record<S["id"], ShortcutRunner>>,
): Record<string, (event: KeyboardEvent) => boolean> {
  const bound = shortcuts.filter((shortcut) => runners[shortcut.id as S["id"]] != undefined);
  const dispatch = (event: KeyboardEvent) => {
    const shortcut = findShortcut(bound, event);
    return shortcut != undefined && runners[shortcut.id as S["id"]]!(event) !== false;
  };
  return Object.fromEntries(
    bound.flatMap((shortcut) => shortcut.keys.map((combo) => [combo.key.toLowerCase(), dispatch])),
  );
}

const KEY_LABELS: Record<string, string> = {
  " ": "Space",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  escape: "Esc",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Delete",
  pageup: "PgUp",
  pagedown: "PgDn",
  home: "Home",
  end: "End",
};

/** Formats a binding with platform modifiers, e.g. "⌘⇧O" on macOS and "Ctrl+Shift+O" elsewhere. */
export function formatCombo(combo: KeyCombo): string {
  const modifiers: ModifierKeys[] = [];
  if (combo.mod === true) {
    modifiers.push("Meta");
  }
  if (combo.alt === true) {
    modifiers.push("Alt");
  }
  if (combo.shift === true) {
    modifiers.push("Shift");
  }
  const lower = combo.key.toLowerCase();
  // A held modifier on its own, e.g. "⇧" or "Shift"
  if (lower === "shift" || lower === "alt") {
    return formatKeyboardShortcut("", [...modifiers, lower === "shift" ? "Shift" : "Alt"]).replace(
      /\+$/,
      "",
    );
  }
  const label = KEY_LABELS[lower] ?? (combo.key.length === 1 ? combo.key.toUpperCase() : combo.key);
  return formatKeyboardShortcut(label, modifiers);
}

/** The first binding of a declared shortcut, e.g. "⌘K", for menus and the command palette. */
export function shortcutLabel<S extends KeyboardShortcut>(
  shortcuts: readonly S[],
  id: S["id"],
): string | undefined {
  const combo = shortcuts.find((shortcut) => shortcut.id === id)?.keys[0];
  return combo != undefined ? formatCombo(combo) : undefined;
}

/** A row in the shortcut overlay. */
export type ShortcutRow = { id: string; title: string; keys: string[] };
export type ShortcutGroup = { id: string; title: string; rows: ShortcutRow[] };

export function shortcutRows(
  shortcuts: readonly KeyboardShortcut[],
  translate: (key: KeyboardShortcutTitleKey) => string,
): ShortcutRow[] {
  return shortcuts.map((shortcut) => ({
    id: shortcut.id,
    title: translate(shortcut.titleKey),
    keys: shortcut.keys.map(formatCombo),
  }));
}

/**
 * One group per panel type with shortcuts, in first-seen order of `panelIds` (put the selected
 * panels first to list them first).
 */
export function panelShortcutGroups(
  panelIds: readonly string[],
  getPanel: (
    type: string,
  ) => { title: string; shortcuts?: readonly KeyboardShortcut[] } | undefined,
  translate: (key: KeyboardShortcutTitleKey) => string,
): ShortcutGroup[] {
  const types = [...new Set(panelIds.map((id) => id.split("!")[0] ?? ""))];
  return types.flatMap((type) => {
    const panel = getPanel(type);
    return panel?.shortcuts != undefined && panel.shortcuts.length > 0
      ? [
          {
            id: `panel:${type}`,
            title: panel.title,
            rows: shortcutRows(panel.shortcuts, translate),
          },
        ]
      : [];
  });
}

// Typed modifier names, so "cmd shift z" finds "⌘⇧Z" and "ctrl+shift+z".
const SYMBOL_WORDS: Record<string, string> = {
  "⌘": " cmd command meta ",
  "⌃": " ctrl control ",
  "⌥": " alt option ",
  "⇧": " shift ",
  "+": " ",
  "←": " left arrow ",
  "→": " right arrow ",
  "↑": " up arrow ",
  "↓": " down arrow ",
};

function searchText(row: ShortcutRow, groupTitle: string): string {
  const keys = row.keys.join(" ").replace(/[⌘⌃⌥⇧+←→↑↓]/g, (symbol) => SYMBOL_WORDS[symbol]!);
  return `${groupTitle} ${row.title} ${keys} ${row.keys.join(" ")}`.toLowerCase();
}

/**
 * Keeps rows where every whitespace-separated query word appears in the group title, row title
 * or keys. Groups left empty are dropped.
 */
export function filterShortcutGroups(
  groups: readonly ShortcutGroup[],
  query: string,
): ShortcutGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [...groups];
  }
  return groups.flatMap((group) => {
    const rows = group.rows.filter((row) => {
      const text = searchText(row, group.title);
      return words.every((word) => text.includes(word));
    });
    return rows.length > 0 ? [{ ...group, rows }] : [];
  });
}
