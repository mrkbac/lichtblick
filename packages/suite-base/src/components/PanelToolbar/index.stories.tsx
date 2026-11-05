// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { Database20Filled } from "@fluentui/react-icons";
import { useTheme } from "@mui/material";
import { PropsWithChildren } from "react";
import { fireEvent, screen } from "storybook/test";
import { StoryObj } from "storybook-react-rsbuild";

import MockPanelContextProvider from "@lichtblick/suite-base/components/MockPanelContextProvider";
import ToolbarIconButton from "@lichtblick/suite-base/components/PanelToolbar/ToolbarIconButton";
import MockCurrentLayoutProvider from "@lichtblick/suite-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import { PanelStateContextProvider } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import WorkspaceContextProvider from "@lichtblick/suite-base/providers/WorkspaceContextProvider";

import PanelToolbar from "./index";

function ToolbarWrapper(props: PropsWithChildren<{ width?: number }>): React.JSX.Element {
  const { children, width = 268 } = props;
  const theme = useTheme();

  return (
    <WorkspaceContextProvider>
      <PanelStateContextProvider>
        <div
          style={{
            width: "100%",
            height: "100%",
            padding: theme.spacing(3),
            position: "relative",
            backgroundColor: theme.palette.background.default,
          }}
        >
          <div style={{ width }}>{children}</div>
        </div>
      </PanelStateContextProvider>
    </WorkspaceContextProvider>
  );
}

export default {
  title: "components/PanelToolbar",
  decorators: [
    (Story: React.ComponentType): React.JSX.Element => {
      // Provide all stories with PanelContext and current layout
      return (
        <MockCurrentLayoutProvider>
          <MockPanelContextProvider>
            <Story />
          </MockPanelContextProvider>
        </MockCurrentLayoutProvider>
      );
    },
  ],
};

const ToolbarContent = (): React.JSX.Element => (
  <div style={{ width: "100%", lineHeight: "22px", paddingLeft: 5 }}>Some controls here</div>
);

type PanelToolbarStoryObj = StoryObj<{ width?: number }>;

export const NonFloatingNarrow: PanelToolbarStoryObj = {
  render: () => {
    return (
      <ToolbarWrapper>
        <PanelToolbar>
          <ToolbarContent />
        </PanelToolbar>
      </ToolbarWrapper>
    );
  },
  name: "non-floating (narrow)",
};

export const NonFloatingWideWithPanelName: PanelToolbarStoryObj = {
  render: (args) => {
    return (
      <ToolbarWrapper {...args}>
        <PanelToolbar>
          <ToolbarContent />
        </PanelToolbar>
      </ToolbarWrapper>
    );
  },
  args: { width: 468 },
  name: "non-floating (wide with panel name)",
};

export const OneAdditionalIcon: PanelToolbarStoryObj = {
  render: (args) => {
    const additionalIcons = (
      <ToolbarIconButton title="database icon">
        <Database20Filled />
      </ToolbarIconButton>
    );
    return (
      <ToolbarWrapper {...args}>
        <PanelToolbar additionalIcons={additionalIcons}>
          <ToolbarContent />
        </PanelToolbar>
      </ToolbarWrapper>
    );
  },
  args: { width: 468 },
  name: "one additional icon",
};

export const MenuOnlyPanel: PanelToolbarStoryObj = {
  render: () => (
    <ToolbarWrapper>
      <PanelToolbar>
        <ToolbarContent />
      </PanelToolbar>
    </ToolbarWrapper>
  ),
  name: "menu (only panel)",
  parameters: { colorScheme: "dark" },
  play: async () => {
    await fireEvent.click(await screen.findByTestId("panel-menu"));
  },
};

export const MenuLight: PanelToolbarStoryObj = {
  render: () => (
    <ToolbarWrapper>
      <PanelToolbar>
        <ToolbarContent />
      </PanelToolbar>
    </ToolbarWrapper>
  ),
  name: "menu light",
  parameters: { colorScheme: "light" },
  play: async () => {
    await fireEvent.click(await screen.findByTestId("panel-menu"));
  },
};

export const MenuWithSiblingPanel: PanelToolbarStoryObj = {
  render: (args) => (
    <ToolbarWrapper {...args}>
      <PanelToolbar>
        <ToolbarContent />
      </PanelToolbar>
    </ToolbarWrapper>
  ),
  name: "menu (with sibling panel)",
  parameters: { colorScheme: "dark" },
  play: async () => {
    await fireEvent.click(await screen.findByTestId("panel-menu"));
  },
};

export const NoToolbars: PanelToolbarStoryObj = {
  render: (args) => (
    <ToolbarWrapper {...args}>
      <PanelToolbar>
        <ToolbarContent />
      </PanelToolbar>
    </ToolbarWrapper>
  ),
  name: "no toolbars",
  parameters: { colorScheme: "dark" },
  play: async () => {
    await fireEvent.click(await screen.findByTestId("panel-menu"));
  },
};

export const Chinese: PanelToolbarStoryObj = {
  ...MenuLight,
  name: undefined,
  parameters: { forceLanguage: "zh", colorScheme: "light" },
};

export const Japanese: PanelToolbarStoryObj = {
  ...MenuLight,
  name: undefined,
  parameters: { forceLanguage: "ja", colorScheme: "light" },
};
