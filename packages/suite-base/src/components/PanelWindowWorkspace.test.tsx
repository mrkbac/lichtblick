/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen, within } from "@testing-library/react";

import { useSelectedPanels } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useWorkspaceStore } from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import MockCurrentLayoutProvider from "@lichtblick/suite-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import WorkspaceContextProvider from "@lichtblick/suite-base/providers/WorkspaceContextProvider";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { PanelWindowWorkspace } from "./PanelWindowWorkspace";

vi.mock("@lichtblick/suite-base/components/PanelSettings", () => ({
  default: function Settings() {
    const { selectedPanelIds } = useSelectedPanels();
    return <div data-testid="selection">{selectedPanelIds.join(",")}</div>;
  },
}));
const selectLeftOpen = (state: Parameters<Parameters<typeof useWorkspaceStore>[0]>[0]) =>
  state.sidebars.left.open;
const selectPreferencesOpen = (state: Parameters<Parameters<typeof useWorkspaceStore>[0]>[0]) =>
  state.dialogs.preferences.open;
function MainState() {
  const leftOpen = useWorkspaceStore(selectLeftOpen);
  const preferencesOpen = useWorkspaceStore(selectPreferencesOpen);
  return (
    <div data-testid="main-state">
      {String(leftOpen)}/{String(preferencesOpen)}
    </div>
  );
}
function Content({ panelId }: { panelId: string }) {
  const { setSelectedPanelIds, selectAllPanels } = useSelectedPanels();
  const { openPanelSettings, dialogActions } = useWorkspaceActions();
  return (
    <>
      <button
        onClick={() => {
          setSelectedPanelIds([panelId]);
          openPanelSettings();
        }}
      >
        Settings
      </button>
      <button onClick={selectAllPanels}>Select all</button>
      <button
        onClick={() => {
          dialogActions.preferences.open();
        }}
      >
        Preferences
      </button>
    </>
  );
}
function setup() {
  return render(
    <ThemeProvider isDark>
      <WorkspaceContextProvider
        disablePersistenceForStorybook
        initialState={{
          sidebars: {
            left: { open: false, item: "panel-settings", size: undefined },
            right: { open: false, item: undefined, size: undefined },
          },
        }}
      >
        <MockCurrentLayoutProvider
          initialState={{
            layout: {
              direction: "row",
              children: [{ panels: ["Tab!one"] }, { panels: ["Tab!two"] }],
            },
            configById: {
              "Tab!one": { tabs: [{ title: "1", layout: { panels: ["Image!one"] } }] },
              "Tab!two": { tabs: [{ title: "2", layout: { panels: ["Plot!two"] } }] },
            },
          }}
        >
          <MainState />
          <div data-testid="first">
            <PanelWindowWorkspace target={window} rootId="Tab!one" title="One">
              <Content panelId="Image!one" />
            </PanelWindowWorkspace>
          </div>
          <div data-testid="second">
            <PanelWindowWorkspace target={window} rootId="Tab!two" title="Two">
              <Content panelId="Plot!two" />
            </PanelWindowWorkspace>
          </div>
        </MockCurrentLayoutProvider>
      </WorkspaceContextProvider>
    </ThemeProvider>,
  );
}

it("keeps each window's settings selection and sidebar independent", () => {
  setup();
  const first = within(screen.getByTestId("first"));
  const second = within(screen.getByTestId("second"));
  fireEvent.click(first.getByText("Settings"));
  expect(first.getByTestId("selection").textContent).toBe("Image!one");
  expect(second.queryByTestId("sidebar-left")).toBeNull();
  expect(screen.getByTestId("main-state").textContent).toBe("false/false");
  fireEvent.click(second.getByText("Settings"));
  expect(second.getByTestId("selection").textContent).toBe("Plot!two");
  expect(first.getByTestId("selection").textContent).toBe("Image!one");
  fireEvent.click(first.getByTestId("sidebar-close-left"));
  expect(first.queryByTestId("sidebar-left")).toBeNull();
  expect(second.getByTestId("selection").textContent).toBe("Plot!two");
});

it("restricts Select all to the window but keeps application dialogs shared", () => {
  setup();
  const first = within(screen.getByTestId("first"));
  fireEvent.click(first.getByText("Settings"));
  fireEvent.click(first.getByText("Select all"));
  expect(first.getByTestId("selection").textContent).toBe("Tab!one,Image!one");
  fireEvent.click(first.getByText("Preferences"));
  expect(screen.getByTestId("main-state").textContent).toBe("false/true");
});
