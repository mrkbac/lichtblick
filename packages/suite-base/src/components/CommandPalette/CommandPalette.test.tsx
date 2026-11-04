/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommandPalette } from "./CommandPalette";
import { Command } from "./commands";
import { useAppCommands } from "./useAppCommands";

jest.mock("./useAppCommands");

const switchLayout = jest.fn();
const seek = jest.fn();

const commands: Command[] = [
  {
    id: "layout.switch",
    title: "Change layout…",
    children: async () => [
      { id: "layout.a", title: "Alpha", run: () => switchLayout("a") },
      { id: "layout.b", title: "Beta", run: () => switchLayout("b") },
    ],
  },
  { id: "help.docs", title: "Open documentation", run: jest.fn() },
];

function openPalette() {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
  return screen.getByRole("combobox");
}

// jsdom has no layout, so it lacks scrollIntoView.
Element.prototype.scrollIntoView = jest.fn();

describe("CommandPalette", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    jest.mocked(useAppCommands).mockReturnValue({
      commands,
      queryCommands: (query) =>
        query === "12.5"
          ? [{ id: "playback.seek", title: "Seek to 0:12.500", run: seek }]
          : [],
    });
  });

  it("opens with Cmd+K and closes with Escape", async () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("combobox")).toBeNull();
    openPalette();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("combobox")).toBeNull();
    });
  });

  it("drills into a sub-menu, goes back, and runs a child with the keyboard", async () => {
    render(<CommandPalette />);
    const input = openPalette();
    await userEvent.type(input, "layout");
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("option", { name: "Alpha" })).toBeTruthy();

    // Backspace on an empty query returns to the root, keeping the root query.
    await userEvent.keyboard("{Backspace}");
    expect(screen.getByRole("combobox")).toHaveProperty("value", "layout");

    await userEvent.keyboard("{Enter}");
    await screen.findByRole("option", { name: "Beta" });
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(switchLayout).toHaveBeenCalledWith("b");
    await waitFor(() => {
      expect(screen.queryByRole("combobox")).toBeNull();
    });

    // The used sub-menu and its entry now rank first.
    openPalette();
    expect(screen.getAllByRole("option")[0]!.textContent).toContain(
      "Change layout",
    );
  });

  it("offers seeking for time input", async () => {
    render(<CommandPalette />);
    await userEvent.type(openPalette(), "12.5{Enter}");
    expect(seek).toHaveBeenCalled();
  });
});
