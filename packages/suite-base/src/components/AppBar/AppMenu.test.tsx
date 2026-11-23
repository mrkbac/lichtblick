/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import type { Mock } from "vitest";

import { AppMenuProps } from "@lichtblick/suite-base/components/AppBar/types";
import { useCommandPaletteStore } from "@lichtblick/suite-base/components/CommandPalette/CommandPalette";
import { usePanelGuideStore } from "@lichtblick/suite-base/components/PanelDocs/PanelGuide";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { useLayoutTransfer } from "@lichtblick/suite-base/hooks/useLayoutTransfer";

import { AppMenu } from "./AppMenu";

vi.mock("react-i18next", () => ({
  useTranslation: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/components/MessagePipeline", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMessagePipeline: (selector: (ctx: unknown) => unknown) => selector({ playerState: {} }),
}));

vi.mock("@lichtblick/suite-base/context/PlayerSelectionContext", () => ({
  usePlayerSelection: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/context/Workspace/useWorkspaceActions", () => ({
  useWorkspaceActions: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutActions: () => ({}),
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
  const mockImportLayout = vi.fn();
  const mockExportLayout = vi.fn();
  const mockSelectRecent = vi.fn();

  beforeEach(() => {
    (useTranslation as Mock).mockReturnValue({
      t: (key: string) => key,
      i18n: { language: "en" },
    });

    (usePlayerSelection as Mock).mockReturnValue({
      recentSources: [{ id: "1", title: "Recent Source 1" }],
      selectRecent: mockSelectRecent,
      availableSources: [],
    });

    (useWorkspaceActions as Mock).mockReturnValue({
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
    render(<AppMenu open={true} handleClose={mockHandleClose} {...props} />);

  it("shows every action in one flat list", () => {
    renderAppMenu();

    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByText("importLayoutFromFile")).toBeInTheDocument();
    expect(screen.getByText("settings")).toBeInTheDocument();
    expect(screen.getByText("about")).toBeInTheDocument();
  });

  it("opens the start dialog", () => {
    renderAppMenu();

    fireEvent.click(screen.getByText("open"));

    expect(mockDialogActions.dataSource.open).toHaveBeenCalledWith("start");
    expect(mockHandleClose).toHaveBeenCalled();
  });

  it("opens settings, extensions and about", () => {
    renderAppMenu();

    fireEvent.click(screen.getByText("settings"));
    fireEvent.click(screen.getByText("extensions"));
    fireEvent.click(screen.getByText("about"));

    expect(mockDialogActions.preferences.open).toHaveBeenNthCalledWith(1);
    expect(mockDialogActions.preferences.open).toHaveBeenNthCalledWith(2, "extensions");
    expect(mockDialogActions.preferences.open).toHaveBeenNthCalledWith(3, "about");
  });

  it("opens the command palette", () => {
    useCommandPaletteStore.getState().hide();
    renderAppMenu();

    fireEvent.click(screen.getByText("commandPalette"));

    expect(useCommandPaletteStore.getState().open).toBe(true);
    expect(mockHandleClose).toHaveBeenCalled();
  });

  it("opens a recent source", () => {
    renderAppMenu();

    fireEvent.click(screen.getByText("Recent Source 1"));

    expect(mockSelectRecent).toHaveBeenCalledWith("1");
    expect(mockHandleClose).toHaveBeenCalled();
  });

  it("shows the file name and location of recent URLs", () => {
    (usePlayerSelection as Mock).mockReturnValue({
      recentSources: [
        {
          id: "1",
          title: "ws://localhost:8765/dir/example.mcap",
          type: "connection",
        },
      ],
      selectRecent: mockSelectRecent,
      availableSources: [],
    });
    renderAppMenu();

    expect(screen.getByText("example.mcap")).toBeInTheDocument();
    expect(screen.getByText("localhost:8765/dir")).toBeInTheDocument();
  });

  it("hides the recent heading without recent sources", () => {
    (usePlayerSelection as Mock).mockReturnValue({
      recentSources: [],
      selectRecent: mockSelectRecent,
      availableSources: [],
    });
    renderAppMenu();

    expect(screen.queryByText("recentDataSources")).not.toBeInTheDocument();
  });

  it("imports and exports layouts", async () => {
    renderAppMenu();

    fireEvent.click(screen.getByText("importLayoutFromFile"));
    fireEvent.click(screen.getByText("exportLayoutToFile"));
    await Promise.resolve();

    expect(mockImportLayout).toHaveBeenCalled();
    expect(mockExportLayout).toHaveBeenCalled();
    expect(mockHandleClose).toHaveBeenCalledTimes(2);
  });

  it("opens the in-app panel guide instead of external documentation", () => {
    usePanelGuideStore.setState({ open: false, panelType: undefined });
    renderAppMenu();

    expect(screen.queryByText("documentation")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("panelGuide"));

    expect(usePanelGuideStore.getState().open).toBe(true);
  });
});
