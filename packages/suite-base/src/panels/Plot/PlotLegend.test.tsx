/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EventEmitter from "eventemitter3";
import { Profiler, useMemo } from "react";
import type { Mock } from "vitest";

import PanelContext from "@lichtblick/suite-base/components/PanelContext";
import { useSelectedPanels } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { BasicBuilder } from "@lichtblick/test-builders";

import type { PlotCoordinator } from "./PlotCoordinator";
import { PlotLegend } from "./PlotLegend";

const defaultProps = {
  saveConfig: vi.fn(),
  sidebarDimension: BasicBuilder.number(),
  paths: [],
  supportsStreamModifiers: true,
};

const getContextValue = () => ({
  type: "foo",
  id: "bar",
  title: "Foo Panel",
  config: {},
  saveConfig: vi.fn(),
  updatePanelConfigs: vi.fn(),
  exitFullscreen: vi.fn(),
  setHasFullscreenDescendant: vi.fn(),
  isFullscreen: false,
  connectToolbarDragHandle: vi.fn(),
  setMessagePathDropConfig: vi.fn(),
  openSiblingPanel: vi.fn(),
  replacePanel: vi.fn(),
  enterFullscreen: vi.fn(),
});

const TestWrapper = ({ children }: { children: React.ReactNode }) => {
  const contextValue = useMemo(getContextValue, []);
  return (
    <PanelContext.Provider value={contextValue}>
      <div>{children}</div>
    </PanelContext.Provider>
  );
};

const setup = (overrides = {}) => {
  const props = { ...defaultProps, ...overrides };
  return render(
    <PanelContext.Provider value={getContextValue()}>
      <TestWrapper>
        <PlotLegend
          coordinator={undefined}
          legendDisplay="floating"
          onClickPath={vi.fn()}
          showValues={false}
          {...props}
        />
      </TestWrapper>
    </PanelContext.Provider>,
  );
};

vi.mock("@lichtblick/suite-base/PanelAPI", () => ({
  useDataSourceInfo: () => ({ topics: [], datatypes: new Map() }),
}));

vi.mock("@lichtblick/suite-base/components/MessagePathSyntax/MessagePathInput", () => ({
  default: ({ path, onChange }: { path: string; onChange: (value: string) => void }) => (
    <input
      aria-label="Message path"
      value={path}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  ),
}));

vi.mock("@lichtblick/suite-base/panels/shared/useSeriesDrag", () => ({
  useSeriesDrag: () => ({ dragRef: undefined, isDragging: false }),
}));

vi.mock("@lichtblick/hooks", () => ({
  useGuaranteedContext: vi.fn(() => ({
    setState: vi.fn(),
    state: {},
  })),
  useSetState: vi.fn(),
  useContext: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutActions: vi.fn(() => ({
    getCurrentLayoutState: vi.fn(),
    setCurrentLayout: vi.fn(),
  })),
  useSelectedPanels: vi.fn(() => []),
}));

describe("PlotLegend", () => {
  const mockSetSelectedPanelIds = vi.fn();
  const path = BasicBuilder.string();
  const secondPath = BasicBuilder.string();

  beforeEach(() => {
    (useSelectedPanels as Mock).mockReturnValue({
      setSelectedPanelIds: mockSetSelectedPanelIds,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders PlotLegend without crashing", () => {
    setup();
    expect(screen.getByTitle("Add series")).toBeDefined();
  });

  it("renders paths from props", () => {
    const paths = [
      { value: path, enabled: true },
      { value: secondPath, enabled: true },
    ];
    setup({ paths });

    expect(screen.getByText(path)).toBeDefined();
    expect(screen.getByText(secondPath)).toBeDefined();
  });

  it("opens the series settings from the settings button", async () => {
    const mockOnClickPath = vi.fn();
    const paths = [{ value: path, enabled: true }];

    setup({ paths, onClickPath: mockOnClickPath });

    await userEvent.setup().click(screen.getByTestId("series-settings"));

    expect(mockOnClickPath).toHaveBeenCalledWith(0);
  });

  it("edits a series path inline", async () => {
    const saveConfig = vi.fn();
    const user = userEvent.setup();
    setup({ paths: [{ value: "/a.x", enabled: true }], saveConfig });

    await user.click(screen.getByText("/a.x"));
    const input = screen.getByLabelText("Message path");
    await user.clear(input);
    await user.type(input, "/a.y{Enter}");

    expect(saveConfig).toHaveBeenCalledWith({ paths: [{ value: "/a.y", enabled: true }] });
    expect(screen.queryByLabelText("Message path")).toBeNull();
  });

  it("adds a series inline and cancels with Escape", async () => {
    const saveConfig = vi.fn();
    const user = userEvent.setup();
    setup({ paths: [{ value: "/a.x", enabled: true }], saveConfig });

    await user.click(screen.getByText("Add series"));
    await user.type(screen.getByLabelText("Message path"), "/b.x{Enter}");
    expect(saveConfig).toHaveBeenCalledWith({
      paths: [
        { value: "/a.x", enabled: true },
        { value: "/b.x", enabled: true, timestampMethod: "receiveTime" },
      ],
    });

    saveConfig.mockClear();
    await user.click(screen.getByText("Add series"));
    await user.type(screen.getByLabelText("Message path"), "/c.x{Escape}");
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("does not re-render when the mismatched-length paths are re-emitted unchanged", () => {
    const coordinator = new EventEmitter();
    const onRender = vi.fn();
    render(
      <TestWrapper>
        <Profiler id="legend" onRender={onRender}>
          <PlotLegend
            {...defaultProps}
            coordinator={coordinator as unknown as PlotCoordinator}
            legendDisplay="floating"
            onClickPath={vi.fn()}
            paths={[{ value: path, enabled: true, timestampMethod: "receiveTime" }]}
            showValues={false}
          />
        </Profiler>
      </TestWrapper>,
    );
    const renders = onRender.mock.calls.length;

    act(() => {
      coordinator.emit("pathsWithMismatchedDataLengthsChanged", []);
      coordinator.emit("pathsWithMismatchedDataLengthsChanged", []);
    });
    expect(onRender).toHaveBeenCalledTimes(renders);

    act(() => {
      coordinator.emit("pathsWithMismatchedDataLengthsChanged", [path]);
    });
    expect(onRender.mock.calls.length).toBeGreaterThan(renders);
  });
});
