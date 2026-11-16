/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Menu } from "@mui/material";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

vi.mock("@lichtblick/suite-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutActions: () => ({
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
    // Given a catalog in a menu, like the app bar's "Add panel" menu, which focuses its list
    // right after it opens
    // When it opens
    render(
      <Providers>
        <Menu open anchorEl={document.body}>
          <PanelCatalog isMenu onPanelSelect={vi.fn()} />
        </Menu>
      </Providers>,
    );

    // Then the search field has focus
    expect(searchField()).toHaveFocus();
  });

  it("keeps the Change panel submenu open with its search focused when its item is clicked", async () => {
    // Given an open panel menu
    const user = userEvent.setup();
    render(
      <Providers>
        <PanelActionsDropdown isUnknownPanel={false} />
      </Providers>,
    );
    await user.click(screen.getByTestId("panel-menu"));

    // When "Change panel" is clicked, twice
    await user.click(screen.getByRole("menuitem", { name: "Change panel" }));
    await user.click(screen.getByRole("menuitem", { name: "Change panel" }));

    // Then the submenu stays open with its search focused
    expect(searchField()).toHaveFocus();
  });

  it("closes the Change panel submenu on a click outside it", async () => {
    // Given an open Change panel submenu
    const user = userEvent.setup();
    render(
      <Providers>
        <PanelActionsDropdown isUnknownPanel={false} />
      </Providers>,
    );
    await user.click(screen.getByTestId("panel-menu"));
    await user.click(screen.getByRole("menuitem", { name: "Change panel" }));
    expect(searchField()).toBeInTheDocument();

    // When the user clicks outside the submenu and its menu item
    await user.click(document.body);

    // Then the submenu closes
    expect(screen.queryByPlaceholderText("Search panels")).not.toBeInTheDocument();
  });
});
