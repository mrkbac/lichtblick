/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";

import { LAYOUT_SHORTCUTS } from "./layoutShortcuts";

vi.mock("@lichtblick/suite-base/util/isDesktopApp", () => ({ default: vi.fn(() => false) }));

const match = (init: KeyboardEventInit) =>
  LAYOUT_SHORTCUTS.find((s) => s.matches(new KeyboardEvent("keydown", init)))?.id;

describe("LAYOUT_SHORTCUTS", () => {
  it("maps keys to undo and redo", () => {
    expect(match({ key: "z", metaKey: true })).toBe("layout.undo");
    expect(match({ key: "z", ctrlKey: true })).toBe("layout.undo");
    expect(match({ key: "Z", metaKey: true, shiftKey: true })).toBe("layout.redo");
    expect(match({ key: "y", ctrlKey: true })).toBe("layout.redo");
    expect(match({ key: "z" })).toBeUndefined();
  });

  it("binds reopen closed panel only in the desktop app", () => {
    const reopen = { key: "t", metaKey: true, shiftKey: true };
    expect(match(reopen)).toBeUndefined();
    vi.mocked(isDesktopApp).mockReturnValue(true);
    expect(match(reopen)).toBe("layout.reopen-panel");
  });
});
