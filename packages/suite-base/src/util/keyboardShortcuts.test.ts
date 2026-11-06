// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  filterShortcutGroups,
  findShortcut,
  formatCombo,
  KeyboardShortcut,
  KeyEventLike,
  panelShortcutGroups,
  shortcutKeyHandlers,
  ShortcutGroup,
} from "./keyboardShortcuts";

const press = (key: string, mods: Partial<KeyEventLike> = {}): KeyboardEvent =>
  ({
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  }) as KeyboardEvent;

const SHORTCUTS = [
  { id: "open", titleKey: "openFile", keys: [{ key: "o", mod: true, shift: false }] },
  { id: "connect", titleKey: "openConnection", keys: [{ key: "o", mod: true, shift: true }] },
  { id: "step", titleKey: "stepForward", keys: [{ key: "ArrowRight" }] },
  { id: "help", titleKey: "showShortcuts", keys: [{ key: "?" }] },
] as const satisfies readonly KeyboardShortcut[];

function withPlatform(userAgent: string, fn: () => void) {
  const spy = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
}

describe("matching", () => {
  it("accepts Cmd or Ctrl for mod and checks Shift only when declared", () => {
    expect(findShortcut(SHORTCUTS, press("o", { metaKey: true }))?.id).toBe("open");
    expect(findShortcut(SHORTCUTS, press("O", { ctrlKey: true, shiftKey: true }))?.id).toBe(
      "connect",
    );
    expect(findShortcut(SHORTCUTS, press("o"))).toBeUndefined();
    expect(findShortcut(SHORTCUTS, press("ArrowRight", { shiftKey: true }))?.id).toBe("step");
    expect(findShortcut(SHORTCUTS, press("?", { shiftKey: true }))?.id).toBe("help");
    // No mod declared, so Cmd+→ (browser navigation) is left alone
    expect(findShortcut(SHORTCUTS, press("ArrowRight", { metaKey: true }))).toBeUndefined();
  });

  it("builds KeyListener handlers that run only bound, matching shortcuts", () => {
    const open = vi.fn();
    const connect = vi.fn(() => false);
    const handlers = shortcutKeyHandlers(SHORTCUTS, { open, connect });
    expect(Object.keys(handlers)).toEqual(["o"]);

    expect(handlers.o!(press("o", { metaKey: true }))).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    // Runner returning false keeps the browser default
    expect(handlers.o!(press("o", { metaKey: true, shiftKey: true }))).toBe(false);
    expect(connect).toHaveBeenCalledTimes(1);
    // Unmatched modifiers fall through
    expect(handlers.o!(press("o"))).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("formatCombo", () => {
  it("uses symbols on macOS", () => {
    withPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", () => {
      expect(formatCombo({ key: "o", mod: true, shift: true })).toBe("⌘⇧O");
      expect(formatCombo({ key: "Shift" })).toBe("⇧");
      expect(formatCombo({ key: "ArrowLeft", alt: true })).toBe("⌥←");
    });
  });

  it("spells out modifiers elsewhere", () => {
    withPlatform("Mozilla/5.0 (X11; Linux x86_64)", () => {
      expect(formatCombo({ key: "o", mod: true, shift: true })).toBe("Ctrl+Shift+O");
      expect(formatCombo({ key: "Alt" })).toBe("Alt");
      expect(formatCombo({ key: " " })).toBe("Space");
      expect(formatCombo({ key: "Escape" })).toBe("Esc");
    });
  });
});

describe("panelShortcutGroups", () => {
  it("lists each panel type once, in first-seen order, skipping panels without shortcuts", () => {
    const panels: Record<string, { title: string; shortcuts?: readonly KeyboardShortcut[] }> = {
      Plot: {
        title: "Plot",
        shortcuts: [{ id: "p", titleKey: "resetView", keys: [{ key: "r" }] }],
      },
      Log: { title: "Log" },
      "3D": {
        title: "3D",
        shortcuts: [{ id: "t", titleKey: "togglePerspective", keys: [{ key: "3" }] }],
      },
    };
    const groups = panelShortcutGroups(
      ["3D!b", "Plot!a", "Log!c", "Plot!d", "3D!b"],
      (type) => panels[type],
      (key) => key,
    );
    expect(groups.map((g) => g.title)).toEqual(["3D", "Plot"]);
    expect(groups[1]!.rows).toEqual([{ id: "p", title: "resetView", keys: ["R"] }]);
  });
});

describe("filterShortcutGroups", () => {
  const groups: ShortcutGroup[] = [
    {
      id: "app",
      title: "App",
      rows: [
        { id: "palette", title: "Open command palette", keys: ["⌘K"] },
        { id: "redo", title: "Redo layout change", keys: ["⌘⇧Z"] },
      ],
    },
    { id: "plot", title: "Plot", rows: [{ id: "reset", title: "Reset view", keys: ["R"] }] },
  ];

  it("returns everything for an empty query", () => {
    expect(filterShortcutGroups(groups, "  ")).toEqual(groups);
  });

  it("matches titles and drops empty groups", () => {
    expect(filterShortcutGroups(groups, "palette")).toEqual([
      { ...groups[0]!, rows: [groups[0]!.rows[0]] },
    ]);
  });

  it("matches group titles", () => {
    expect(filterShortcutGroups(groups, "plot")).toEqual([groups[1]]);
  });

  it("matches keys by symbol or modifier name", () => {
    expect(filterShortcutGroups(groups, "⌘⇧z")[0]?.rows.map((r) => r.id)).toEqual(["redo"]);
    expect(filterShortcutGroups(groups, "cmd shift")[0]?.rows.map((r) => r.id)).toEqual(["redo"]);
  });
});
