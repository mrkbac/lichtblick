/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import type { Mock } from "vitest";

import { AppMenuProps } from "@lichtblick/suite-base/components/AppBar/types";
import { LICHTBLICK_DOCUMENTATION_LINK } from "@lichtblick/suite-base/constants/documentation";
import AnalyticsContext from "@lichtblick/suite-base/context/AnalyticsContext";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceStore } from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { useLayoutTransfer } from "@lichtblick/suite-base/hooks/useLayoutTransfer";
import { AppEvent } from "@lichtblick/suite-base/services/IAnalytics";
import type IAnalytics from "@lichtblick/suite-base/services/IAnalytics";

import { AppMenu } from "./AppMenu";

vi.mock("react-i18next", () => ({
  useTranslation: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/context/PlayerSelectionContext", () => ({
  usePlayerSelection: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/context/Workspace/WorkspaceContext", () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/context/Workspace/useWorkspaceActions", () => ({
  useWorkspaceActions: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/hooks/useLayoutTransfer", () => ({
  useLayoutTransfer: vi.fn(),
}));

describe("AppMenu", () => {
  const mockHandleClose = vi.fn();
  const mockDialogActions = {
    dataSource: { open: vi.fn() },
    openFile: { open: vi.fn() },
    preferences: { open: vi.fn() },
  };
  const mockSidebarActions = {
    left: { setOpen: vi.fn() },
    right: { setOpen: vi.fn() },
  };
  const mockImportLayout = vi.fn();
  const mockExportLayout = vi.fn();
  const mockSelectRecent = vi.fn();
  const mockClearRecents = vi.fn();
  const logEvent = vi.fn();
  const mockAnalytics: IAnalytics = { logEvent };

  beforeEach(() => {
    (useTranslation as Mock).mockReturnValue({
      t: (key: string) => key,
      i18n: { language: "en" },
    });

    (usePlayerSelection as Mock).mockReturnValue({
      recentSources: [{ id: "1", title: "Recent Source 1" }],
      selectRecent: mockSelectRecent,
      clearRecents: mockClearRecents,
      availableSources: [],
    });

    (useWorkspaceStore as Mock).mockImplementation((selector) =>
      selector({
        sidebars: { left: { open: false }, right: { open: true } },
      }),
    );

    (useWorkspaceActions as Mock).mockReturnValue({
      sidebarActions: mockSidebarActions,
      dialogActions: mockDialogActions,
    });

    (useLayoutTransfer as Mock).mockReturnValue({
      importLayout: mockImportLayout,
      exportLayout: mockExportLayout,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const renderAppMenu = (props: Partial<AppMenuProps> = {}) =>
    render(
      <AnalyticsContext.Provider value={mockAnalytics}>
        <AppMenu open={true} handleClose={mockHandleClose} disablePortal={false} {...props} />
      </AnalyticsContext.Provider>,
    );

  it("renders the menu with File, View, and Help sections", () => {
    renderAppMenu();

    expect(screen.getByText("file")).toBeInTheDocument();
    expect(screen.getByText("view")).toBeInTheDocument();
    expect(screen.getByText("help")).toBeInTheDocument();
  });

  it("handles File menu actions", () => {
    renderAppMenu();

    fireEvent.pointerEnter(screen.getByText("file"));
    fireEvent.click(screen.getByText("open"));

    expect(mockDialogActions.dataSource.open).toHaveBeenCalledWith("start");
    expect(mockHandleClose).toHaveBeenCalled();
  });

  it("logs app menu interactions for clicked menu items", () => {
    // Given
    renderAppMenu();

    // When
    fireEvent.pointerEnter(screen.getByText("file"));
    fireEvent.click(screen.getByText("open"));

    // Then
    expect(logEvent).toHaveBeenCalledWith(AppEvent.APP_MENU_CLICK, {
      id: "menu-item-open",
    });
  });

  it("handles View menu actions", () => {
    renderAppMenu();

    fireEvent.pointerEnter(screen.getByText("view"));
    fireEvent.click(screen.getByText("showLeftSidebar"));

    expect(mockSidebarActions.left.setOpen).toHaveBeenCalledWith(true);
    expect(mockHandleClose).toHaveBeenCalled();
  });

  it("handles Help menu actions", () => {
    renderAppMenu();

    fireEvent.pointerEnter(screen.getByText("help"));
    fireEvent.click(screen.getByText("about"));

    expect(mockDialogActions.preferences.open).toHaveBeenCalledWith("about");
    expect(mockHandleClose).toHaveBeenCalled();
  });

  it("handles recent sources in File menu", () => {
    renderAppMenu();

    fireEvent.pointerEnter(screen.getByText("file"));
    fireEvent.click(screen.getByText("Recent Source 1"));

    expect(mockSelectRecent).toHaveBeenCalledWith("1");
    expect(mockHandleClose).toHaveBeenCalled();
  });
  it("shows the file name of recent URLs and clears unpinned recents", () => {
    (usePlayerSelection as Mock).mockReturnValue({
      recentSources: [
        {
          id: "1",
          title: "ws://localhost:8765/dir/example.mcap",
          type: "connection",
        },
      ],
      selectRecent: mockSelectRecent,
      clearRecents: mockClearRecents,
      availableSources: [],
    });
    renderAppMenu();

    fireEvent.pointerEnter(screen.getByText("file"));
    expect(screen.getByText("example.mcap")).toBeInTheDocument();
    expect(screen.getByText("localhost:8765/dir")).toBeInTheDocument();

    fireEvent.click(screen.getByText("clearRecentDataSources"));
    expect(mockClearRecents).toHaveBeenCalled();
  });

  it("opens the start dialog to see all recents", () => {
    renderAppMenu();

    fireEvent.pointerEnter(screen.getByText("file"));
    fireEvent.click(screen.getByText("allRecentDataSources"));

    expect(mockDialogActions.dataSource.open).toHaveBeenCalledWith("start");
  });

  it("handles layout import and export in View menu", async () => {
    renderAppMenu();

    fireEvent.pointerEnter(screen.getByText("view"));
    fireEvent.click(screen.getByText("importLayoutFromFile"));
    await Promise.resolve();

    expect(mockImportLayout).toHaveBeenCalled();
    expect(mockHandleClose).toHaveBeenCalled();

    fireEvent.click(screen.getByText("exportLayoutToFile"));
    await Promise.resolve();

    expect(mockExportLayout).toHaveBeenCalled();
    expect(mockHandleClose).toHaveBeenCalled();
  });

  it("opens documentation link in Help menu", () => {
    const originalOpen = window.open;
    window.open = vi.fn();

    renderAppMenu();

    fireEvent.pointerEnter(screen.getByText("help"));
    fireEvent.click(screen.getByText("documentation"));

    expect(window.open).toHaveBeenCalledWith(
      LICHTBLICK_DOCUMENTATION_LINK,
      "_blank",
      "noopener,noreferrer",
    );

    window.open = originalOpen;
  });
});
