/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Menu } from "@mui/material";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { PanelCatalog } from "@lichtblick/suite-base/components/PanelCatalog";
import PanelContext from "@lichtblick/suite-base/components/PanelContext";
import { PanelActionsDropdown } from "@lichtblick/suite-base/components/PanelToolbar/PanelActionsDropdown";
import { PanelContextType } from "@lichtblick/suite-base/components/types";
import PanelCatalogContext, {
  PanelCatalog as PanelCatalogType,
} from "@lichtblick/suite-base/context/PanelCatalogContext";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import { PanelConfig } from "@lichtblick/suite-base/types/panels";

const addPanel = vi.fn();
vi.mock("@lichtblick/suite-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutActions: () => ({
    addPanel,
    swapPanel: vi.fn(),
    closePanel: vi.fn(),
    splitPanel: vi.fn(),
    getCurrentLayoutState: () => ({}),
  }),
}));

const panels = [
  { title: "Plot", type: "Plot", module: vi.fn() },
  { title: "Raw Messages", type: "RawMessages", module: vi.fn() },
];
const catalog = {
  getPanels: () => panels,
  getPanelByType: (type: string) => panels.find((panel) => panel.type === type),
} as unknown as PanelCatalogType;

function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ThemeProvider isDark={false}>
      <PanelCatalogContext.Provider value={catalog}>
        <PanelContext.Provider
          value={{ id: "Tab!a", type: "Tab" } as unknown as PanelContextType<PanelConfig>}
        >
          {children}
        </PanelContext.Provider>
      </PanelCatalogContext.Provider>
    </ThemeProvider>
  );
}

function searchField(): HTMLElement {
  return screen.getByPlaceholderText("Search panels");
}

describe("panel catalog search focus", () => {
  it("focuses the search field when the catalog opens in a menu", () => {
    // Like the app bar's "Add panel" menu: the menu focuses its list right after it opens.
    render(
      <Providers>
        <Menu open anchorEl={document.body}>
          <PanelCatalog isMenu onPanelSelect={vi.fn()} />
        </Menu>
      </Providers>,
    );

    expect(searchField()).toHaveFocus();
  });

  it("keeps the New tab submenu open with its search focused when its item is clicked", () => {
    render(
      <Providers>
        <PanelActionsDropdown isUnknownPanel={false} />
      </Providers>,
    );
    fireEvent.click(screen.getByTestId("panel-menu"));

    const newTab = screen.getByTestId("panel-menu-new-tab");
    expect(fireEvent.mouseDown(newTab)).toBe(false); // the press doesn't take focus
    fireEvent.click(newTab);

    expect(searchField()).toHaveFocus();
    fireEvent.change(searchField(), { target: { value: "raw" } });
    fireEvent.keyDown(searchField(), { key: "Enter" });
    expect(addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ position: "center", targetPanelId: "Tab!a" }),
    );
  });
});
