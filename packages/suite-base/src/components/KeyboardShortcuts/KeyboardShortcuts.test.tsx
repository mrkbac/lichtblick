/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen } from "@testing-library/react";

import { KeyboardShortcuts, useKeyboardShortcutsStore } from "./KeyboardShortcuts";

vi.mock("@lichtblick/suite-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutSelector: () => ({
    direction: "row",
    children: [{ panels: ["Plot!a", "Log!b"] }],
  }),
  useSelectedPanels: () => ({ selectedPanelIds: [] }),
}));
vi.mock("@lichtblick/suite-base/context/PanelCatalogContext", () => ({
  usePanelCatalog: () => ({
    getPanelByType: (type: string) =>
      type === "Plot"
        ? { title: "Plot", shortcuts: [{ id: "r", titleKey: "resetView", keys: [{ key: "r" }] }] }
        : undefined,
  }),
}));

describe("KeyboardShortcuts", () => {
  afterEach(() => {
    act(() => {
      useKeyboardShortcutsStore.getState().hide();
    });
    document.body.innerHTML = "";
  });

  it("opens on ? and lists app, playback, layout and panel shortcuts", () => {
    render(<KeyboardShortcuts />);
    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    expect(useKeyboardShortcutsStore.getState().open).toBe(true);
    expect(screen.getByRole("dialog")).toBeTruthy();
    for (const group of ["App", "Playback", "Layout", "Plot"]) {
      expect(screen.getByRole("region", { name: group })).toBeTruthy();
    }
  });

  it("filters by the search field", () => {
    render(<KeyboardShortcuts />);
    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hovered plot r" } });
    expect(screen.queryAllByRole("region").map((el) => el.getAttribute("aria-label"))).toEqual([
      "Plot",
    ]);
  });

  it.each([
    ["an input", () => document.createElement("input")],
    ["a textarea", () => document.createElement("textarea")],
    [
      "a code editor",
      () => {
        const editor = document.createElement("div");
        editor.className = "monaco-editor";
        const inner = document.createElement("span");
        editor.appendChild(inner);
        return inner;
      },
    ],
  ])("ignores ? typed into %s", (_name, make) => {
    render(<KeyboardShortcuts />);
    const target = make();
    document.body.appendChild(target.closest(".monaco-editor") ?? target);
    fireEvent.keyDown(target, { key: "?", shiftKey: true });
    expect(useKeyboardShortcutsStore.getState().open).toBe(false);
  });
});
