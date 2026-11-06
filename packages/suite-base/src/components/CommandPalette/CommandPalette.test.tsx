/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommandPalette, useCommandPaletteStore } from "./CommandPalette";
import { Command } from "./commands";
import { useAppCommands } from "./useAppCommands";

vi.mock("./useAppCommands");

const switchLayout = vi.fn();
const seek = vi.fn();

const commands: Command[] = [
  {
    id: "layout.switch",
    title: "Change layout…",
    children: async () => [
      { id: "layout.a", title: "Alpha", run: () => switchLayout("a") },
      { id: "layout.b", title: "Beta", run: () => switchLayout("b") },
    ],
  },
  { id: "help.docs", title: "Open documentation", run: vi.fn() },
];

function openPalette() {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
  return screen.getByRole("combobox");
}

// jsdom has no layout, so it lacks scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

describe("CommandPalette", () => {
  beforeEach(() => {
    useCommandPaletteStore.getState().hide();
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(useAppCommands).mockReturnValue({
      commands,
      queryCommands: (query) =>
        query === "12.5" ? [{ id: "playback.seek", title: "Seek to 0:12.500", run: seek }] : [],
    });
  });

  it("opens with Cmd+K and closes with Escape", async () => {
    // Given a closed palette
    render(<CommandPalette />);
    expect(screen.queryByRole("combobox")).toBeNull();

    // When opening it with Cmd+K, then pressing Escape
    openPalette();
    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    await userEvent.keyboard("{Escape}");

    // Then it opened as a named dialog and closed again
    expect(dialog).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("combobox")).toBeNull();
    });
  });

  it("opens from outside through the store", () => {
    // Given a closed palette
    render(<CommandPalette />);

    // When a menu opens it
    act(() => {
      useCommandPaletteStore.getState().show();
    });

    // Then it shows
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("drills into a sub-menu and back with the keyboard", async () => {
    // Given the palette opened and filtered to a command with a sub-menu
    render(<CommandPalette />);
    await userEvent.type(openPalette(), "layout");

    // When entering the sub-menu, then pressing Backspace on its empty query
    await userEvent.keyboard("{Enter}");
    const child = await screen.findByRole("option", { name: "Alpha" });
    await userEvent.keyboard("{Backspace}");

    // Then the sub-menu was shown and going back keeps the root query
    expect(child).toBeTruthy();
    expect(screen.getByRole("combobox")).toHaveProperty("value", "layout");
  });

  it("runs a sub-menu item and ranks the used sub-menu first next time", async () => {
    // Given the palette inside a sub-menu
    render(<CommandPalette />);
    await userEvent.type(openPalette(), "layout{Enter}");
    await screen.findByRole("option", { name: "Beta" });

    // When choosing the second item, then reopening the palette
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => {
      expect(screen.queryByRole("combobox")).toBeNull();
    });
    openPalette();

    // Then the item ran and its sub-menu ranks first
    expect(switchLayout).toHaveBeenCalledWith("b");
    expect(screen.getAllByRole("option")[0]!.textContent).toContain("Change layout");
  });

  it("offers seeking for time input", async () => {
    // Given an open palette
    render(<CommandPalette />);
    const input = openPalette();

    // When typing a time and pressing Enter
    await userEvent.type(input, "12.5{Enter}");

    // Then playback seeks
    expect(seek).toHaveBeenCalled();
  });
});
