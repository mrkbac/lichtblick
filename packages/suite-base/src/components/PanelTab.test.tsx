/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";

import { TAB_HOVER_ACTIVATE_MS, TabTitleInput, useDragHoverActivation } from "./PanelTab";

function Tab({ activate }: { activate: () => void }): React.JSX.Element {
  const handlers = useDragHoverActivation(activate);
  return (
    <div data-testid="tab" {...handlers}>
      <span data-testid="label">label</span>
    </div>
  );
}

describe("useDragHoverActivation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("activates after the drag rests on the tab", () => {
    const activate = vi.fn();
    render(<Tab activate={activate} />);

    fireEvent.dragEnter(screen.getByTestId("tab"));
    vi.advanceTimersByTime(TAB_HOVER_ACTIVATE_MS - 1);
    expect(activate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting while the drag moves between the tab's children", () => {
    const activate = vi.fn();
    render(<Tab activate={activate} />);
    const tab = screen.getByTestId("tab");

    fireEvent.dragEnter(tab);
    fireEvent.dragLeave(tab, { relatedTarget: screen.getByTestId("label") });
    fireEvent.dragEnter(screen.getByTestId("label"));
    vi.advanceTimersByTime(TAB_HOVER_ACTIVATE_MS);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("cancels when the drag leaves or drops first", () => {
    const activate = vi.fn();
    render(<Tab activate={activate} />);
    const tab = screen.getByTestId("tab");

    fireEvent.dragEnter(tab);
    fireEvent.dragLeave(tab, { relatedTarget: document.body });
    fireEvent.dragEnter(tab);
    fireEvent.drop(tab);
    vi.advanceTimersByTime(TAB_HOVER_ACTIVATE_MS * 2);
    expect(activate).not.toHaveBeenCalled();
  });
});

describe("TabTitleInput", () => {
  it("saves the trimmed title on Enter, and nothing on Escape", () => {
    const onSave = vi.fn();
    const onDone = vi.fn();
    const { unmount } = render(
      <TabTitleInput initialTitle="Plot" onSave={onSave} onDone={onDone} />,
    );
    fireEvent.keyDown(screen.getByLabelText("Tab title"), { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
    unmount();

    render(<TabTitleInput initialTitle="Plot" onSave={onSave} onDone={onDone} />);
    const input = screen.getByLabelText("Tab title");
    fireEvent.change(input, { target: { value: "  Speed " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("Speed");
  });
});
