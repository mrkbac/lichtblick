/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MenuItem } from "@mui/material";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import MultiProvider from "@lichtblick/suite-base/components/MultiProvider";
import StudioToastProvider from "@lichtblick/suite-base/components/StudioToastProvider";
import AppConfigurationContext from "@lichtblick/suite-base/context/AppConfigurationContext";
import LayoutManagerContext from "@lichtblick/suite-base/context/LayoutManagerContext";
import {
  OrganizationProvider,
  type OrganizationState,
} from "@lichtblick/suite-base/context/OrganizationContext";
import PlayerSelectionContext, {
  type IDataSourceFactory,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { initI18n } from "@lichtblick/suite-base/i18n";
import MockCurrentLayoutProvider from "@lichtblick/suite-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import TimelineInteractionStateProvider from "@lichtblick/suite-base/providers/TimelineInteractionStateProvider";
import WorkspaceContextProvider from "@lichtblick/suite-base/providers/WorkspaceContextProvider";
import MockLayoutManager from "@lichtblick/suite-base/services/LayoutManager/MockLayoutManager";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@lichtblick/suite-base/util/makeMockAppConfiguration";

import { AppBar } from ".";

function Wrapper({ children }: React.PropsWithChildren): React.JSX.Element {
  const appConfiguration = makeMockAppConfiguration();
  const providers = [
    /* eslint-disable react/jsx-key */
    <WorkspaceContextProvider />,
    <AppConfigurationContext.Provider value={appConfiguration} />,
    <StudioToastProvider />,
    <TimelineInteractionStateProvider />,
    <MockMessagePipelineProvider />,
    <MockCurrentLayoutProvider />,
    <ThemeProvider isDark />,
    <LayoutManagerContext.Provider value={new MockLayoutManager()} />,
    /* eslint-enable react/jsx-key */
  ];
  return <MultiProvider providers={providers}>{children}</MultiProvider>;
}

describe("<AppBar />", () => {
  beforeAll(async () => {
    await initI18n();
  });
  it.each<OrganizationState>([
    { status: "disabled" },
    { status: "loading" },
    { status: "unauthenticated", login: async () => {} },
  ])("opens transport account actions when the organization is $status", async (organization) => {
    const user = userEvent.setup();
    const action = vi.fn();
    const accountSource: IDataSourceFactory = {
      id: "account-source",
      displayName: "Account source",
      type: "connection",
      hidden: true,
      initialize: () => undefined,
      AccountMenuItems: ({ onClose }) => (
        <>
          <MenuItem>First action</MenuItem>
          <MenuItem
            onClick={() => {
              action();
              onClose();
            }}
          >
            Second action
          </MenuItem>
        </>
      ),
    };
    function WithSource(): React.JSX.Element {
      const selection = usePlayerSelection();
      return (
        <PlayerSelectionContext.Provider
          value={{ ...selection, availableSources: [accountSource] }}
        >
          <OrganizationProvider value={organization}>
            <AppBar />
          </OrganizationProvider>
        </PlayerSelectionContext.Provider>
      );
    }
    render(
      <Wrapper>
        <WithSource />
      </Wrapper>,
    );
    await user.click(screen.getByRole("button", { name: "User profile menu button" }));
    const first = await screen.findByRole("menuitem", { name: "First action" });
    const initial =
      organization.status === "unauthenticated"
        ? screen.getByRole("menuitem", { name: "Sign in to server" })
        : first;
    expect(document.activeElement).toBe(initial);
    if (initial !== first) {
      await user.keyboard("{ArrowDown}");
    }
    expect(document.activeElement).toBe(first);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(action).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  it("keeps the server-only account login label", async () => {
    const login = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <Wrapper>
        <OrganizationProvider value={{ status: "unauthenticated", login }}>
          <AppBar />
        </OrganizationProvider>
      </Wrapper>,
    );
    await user.click(screen.getByRole("button", { name: "User profile menu button" }));
    await user.click(screen.getByRole("menuitem", { name: "Log in" }));
    expect(login).toHaveBeenCalledOnce();
  });

  it("calls functions for custom window controls", async () => {
    const mockMinimize = vi.fn();
    const mockMaximize = vi.fn();
    const mockUnmaximize = vi.fn();
    const mockClose = vi.fn();

    const root = render(
      <Wrapper>
        <AppBar
          showCustomWindowControls
          onMinimizeWindow={mockMinimize}
          onMaximizeWindow={mockMaximize}
          onUnmaximizeWindow={mockUnmaximize}
          onCloseWindow={mockClose}
        />
      </Wrapper>,
    );

    const minButton = await root.findByTestId("win-minimize");
    minButton.click();
    expect(mockMinimize).toHaveBeenCalled();

    const maxButton = await root.findByTestId("win-maximize");
    maxButton.click();
    expect(mockMaximize).toHaveBeenCalled();
    expect(mockUnmaximize).not.toHaveBeenCalled();

    root.rerender(
      <Wrapper>
        <AppBar
          showCustomWindowControls
          onMinimizeWindow={mockMinimize}
          onMaximizeWindow={mockMaximize}
          onUnmaximizeWindow={mockUnmaximize}
          onCloseWindow={mockClose}
          isMaximized
          initialZoomFactor={1}
        />
      </Wrapper>,
    );
    maxButton.click();
    expect(mockUnmaximize).toHaveBeenCalled();

    const closeButton = await root.findByTestId("win-close");
    closeButton.click();
    expect(mockClose).toHaveBeenCalled();

    root.unmount();
  });
});
