/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";

import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { Notes, SAVE_DEBOUNCE_MS } from "./Notes";
import { NotesConfig } from "./types";

jest.mock("@lichtblick/suite-base/components/PanelToolbar", () => ({
  __esModule: true,
  default: ({ additionalIcons }: { additionalIcons?: React.ReactNode }) => (
    <div>{additionalIcons}</div>
  ),
}));

jest.mock("./settings", () => ({ useNotesSettings: jest.fn() }));

function setup(config: NotesConfig = { text: "" }) {
  const saveConfig = jest.fn();
  const result = render(
    <ThemeProvider isDark={false}>
      <Notes config={config} saveConfig={saveConfig} />
    </ThemeProvider>,
  );
  return { ...result, saveConfig };
}

function type(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
}

describe("Notes", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows a placeholder inviting edits when empty", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Start writing" }));
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("renders markdown with GFM task lists in view mode", () => {
    setup({ text: "# Hello\n\n- [x] done" });
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("enters edit mode on double-click", () => {
    setup({ text: "hello" });
    fireEvent.doubleClick(screen.getByText("hello"));
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox");
    expect(editor).toHaveValue("hello");
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe("hello".length);
  });

  it("debounces saves while typing", () => {
    const { saveConfig } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Start writing" }));
    type("a");
    type("ab");
    expect(saveConfig).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });
    expect(saveConfig).toHaveBeenCalledTimes(1);
    expect(saveConfig).toHaveBeenCalledWith({ text: "ab" });
  });

  it("flushes pending text on blur", () => {
    const { saveConfig } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Start writing" }));
    type("draft");
    fireEvent.blur(screen.getByRole("textbox"));
    expect(saveConfig).toHaveBeenCalledWith({ text: "draft" });
  });

  it.each([
    { name: "Escape", key: "Escape" },
    { name: "Cmd+Enter", key: "Enter", metaKey: true },
    { name: "Ctrl+Enter", key: "Enter", ctrlKey: true },
  ])("flushes and leaves edit mode on $name", ({ name: _name, ...keyEvent }) => {
    const { saveConfig } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Start writing" }));
    type("draft");
    fireEvent.keyDown(screen.getByRole("textbox"), keyEvent);
    expect(saveConfig).toHaveBeenCalledWith({ text: "draft" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("flushes pending text on unmount", () => {
    const { saveConfig, unmount } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Start writing" }));
    type("draft");
    unmount();
    expect(saveConfig).toHaveBeenCalledWith({ text: "draft" });
  });

  it("toggles a task checkbox in view mode", () => {
    const { saveConfig } = setup({ text: "- [ ] one\n- [ ] two" });
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(saveConfig).toHaveBeenCalledWith({ text: "- [ ] one\n- [x] two" });
  });
});
