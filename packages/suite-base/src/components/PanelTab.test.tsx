/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { IDockviewPanelHeaderProps } from "dockview-react";

import { setPanelDragData } from "@lichtblick/suite-base/components/PanelCatalog/panelDrag";
import { PanelsActions } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import MockCurrentLayoutProvider from "@lichtblick/suite-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";

import { PanelTab, TAB_HOVER_ACTIVATE_MS, useDragHoverActivation } from "./PanelTab";

// The real tab needs a live dockview; a plain element that keeps the drag handlers is enough here.
vi.mock("dockview-react", () => ({
  DockviewDefaultTab: ({
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
  }: React.HTMLAttributes<HTMLDivElement>) => (
    <div
      data-testid="dockview-tab"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    />
  ),
  getPanelData: () => undefined,
}));

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
    const api = { id: "Plot!a", isVisible: false, setActive: vi.fn(), group: {} };
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
    // jsdom has no DataTransfer
    const data = new Map<string, string>();
    const types: string[] = [];
    const dataTransfer = {
      effectAllowed: "none",
      types,
      setData: (type: string, value: string) => {
        data.set(type, value);
        types.push(type);
      },
      getData: (type: string) => data.get(type) ?? "",
    } as unknown as DataTransfer;
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

  it("opens a background tab after a drag rests on it", () => {
    vi.useFakeTimers();
    const api = renderTab(vi.fn());
    fireEvent.dragEnter(screen.getByTestId("dockview-tab"));
    vi.advanceTimersByTime(TAB_HOVER_ACTIVATE_MS);
    expect(api.setActive).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
