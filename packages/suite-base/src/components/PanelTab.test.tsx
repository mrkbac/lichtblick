/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen } from "@testing-library/react";
import { IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from "dockview-react";

import { setPanelDragData } from "@lichtblick/suite-base/components/PanelCatalog/panelDrag";
import { PanelsActions } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import MockCurrentLayoutProvider from "@lichtblick/suite-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";

import {
  NewTabDropTarget,
  PanelTab,
  TAB_HOVER_ACTIVATE_MS,
  useDragHoverActivation,
} from "./PanelTab";

// The real tab needs a live dockview; a plain element that keeps the drag handlers is enough here.
vi.mock("dockview-react", () => ({
  DockviewDefaultTab: ({
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    onDoubleClick,
  }: React.HTMLAttributes<HTMLDivElement>) => (
    <div
      data-testid="dockview-tab"
      onDoubleClick={onDoubleClick}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    />
  ),
  getPanelData: () => undefined,
}));

/** jsdom has no DataTransfer. */
function fakeDataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  const types: string[] = [];
  return {
    effectAllowed: "none",
    types,
    setData: (type: string, value: string) => {
      data.set(type, value);
      types.push(type);
    },
    getData: (type: string) => data.get(type) ?? "",
  } as unknown as DataTransfer;
}

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

describe("PanelTab", () => {
  function renderTab(onAction: (action: PanelsActions) => void) {
    const api = {
      id: "Plot!a",
      title: "Plot",
      isVisible: false,
      setActive: vi.fn(),
      group: { activePanel: { id: "Plot!a" }, panels: [{ id: "Plot!a" }] },
    };
    const props = {
      api,
      containerApi: { id: "dock" },
      params: {},
    } as unknown as IDockviewPanelHeaderProps;
    render(
      <MockCurrentLayoutProvider onAction={onAction}>
        <PanelTab {...props} />
      </MockCurrentLayoutProvider>,
    );
    return api;
  }

  it("adds a panel dropped from the catalog to the tab's group", () => {
    const onAction = vi.fn();
    renderTab(onAction);
    const dataTransfer = fakeDataTransfer();
    setPanelDragData(dataTransfer, { type: "Gauge", config: { path: "/a" } });

    fireEvent.drop(screen.getByTestId("dockview-tab"), { dataTransfer });

    expect(onAction).toHaveBeenCalledWith({
      type: "ADD_PANEL",
      payload: expect.objectContaining({
        config: { path: "/a" },
        position: "center",
        targetPanelId: "Plot!a",
      }),
    });
  });

  it("renames the tab on double-click and Enter, and cancels on Escape", () => {
    const onAction = vi.fn();
    renderTab(onAction);

    fireEvent.doubleClick(screen.getByTestId("dockview-tab"));
    fireEvent.keyDown(screen.getByLabelText("Tab title"), { key: "Escape" });
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByTestId("dockview-tab"));
    const input = screen.getByLabelText("Tab title");
    fireEvent.change(input, { target: { value: "  Speed " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({
      type: "SAVE_PANEL_CONFIGS",
      payload: { configs: [{ id: "Plot!a", config: { lichtblickPanelTitle: "Speed" } }] },
    });
    expect(screen.getByTestId("dockview-tab")).toBeTruthy();
  });

  it("opens a background tab after a drag rests on it", () => {
    vi.useFakeTimers();
    const api = renderTab(vi.fn());
    fireEvent.dragEnter(screen.getByTestId("dockview-tab"));
    vi.advanceTimersByTime(TAB_HOVER_ACTIVATE_MS);
    expect(api.setActive).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("NewTabDropTarget", () => {
  function renderTarget(onAction: (action: PanelsActions) => void) {
    const group = { activePanel: { id: "Plot!a" }, panels: [{ id: "Plot!a" }, { id: "Map!b" }] };
    const props = { group, containerApi: { id: "dock" } } as unknown as IDockviewHeaderActionsProps;
    render(
      <MockCurrentLayoutProvider onAction={onAction}>
        <NewTabDropTarget {...props} />
      </MockCurrentLayoutProvider>,
    );
  }

  it("shows only while a panel is dragged, and adds the dropped panel as a new tab", () => {
    vi.useFakeTimers();
    const onAction = vi.fn();
    renderTarget(onAction);
    expect(screen.queryByTestId("new-tab-drop-target")).toBeNull();
    expect(screen.getByTestId("new-tab-button")).toBeTruthy();

    const dataTransfer = fakeDataTransfer();
    setPanelDragData(dataTransfer, { type: "Gauge" });
    fireEvent.dragOver(document.body, { dataTransfer });
    const target = screen.getByTestId("new-tab-drop-target");
    expect(target.textContent).toEqual("+ New tab");

    fireEvent.drop(target, { dataTransfer });
    expect(onAction).toHaveBeenCalledWith({
      type: "ADD_PANEL",
      payload: expect.objectContaining({ position: "center", targetPanelId: "Plot!a" }),
    });
    // The target goes away after the drop, not before React has delivered it.
    expect(screen.getByTestId("new-tab-drop-target")).toBeTruthy();
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByTestId("new-tab-drop-target")).toBeNull();
    vi.useRealTimers();
  });
});
