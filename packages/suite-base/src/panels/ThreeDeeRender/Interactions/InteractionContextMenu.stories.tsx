// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { useTheme } from "@mui/material";
import { StoryObj } from "storybook-react-rsbuild";

import { InteractionContextMenu } from "./InteractionContextMenu";
import type { Renderable } from "../Renderable";

const sharedProps = {
  selectObject: () => {},
  clickedObjects: [
    { renderable: { name: "/foo/bar" } as Renderable },
    { renderable: { name: "/foo1/bar" } as Renderable },
    { renderable: { name: "/abc/xyz" } as Renderable, instanceIndex: 10 },
    {
      renderable: {
        name: "/some_topic_name/nested_name/with_very_very_very_longer_name/",
      } as Renderable,
      instanceIndex: 10,
    },
    {
      renderable: { name: "/some_topic/with_slightly_longer_names" } as Renderable,
      instanceIndex: 10,
    },
  ],
  clickedPosition: { clientX: 100, clientY: 200 },
};

export default {
  title: "panels/ThreeDeeRender/Interactions/InteractionContextMenu",
  component: InteractionContextMenu,
  decorators: [
    (Story: React.ComponentType): React.JSX.Element => {
      const theme = useTheme();

      return (
        <div
          style={{ height: "100vh", width: "100vh", background: theme.palette.background.default }}
        >
          <Story />
        </div>
      );
    },
  ],
};

export const Light: StoryObj = {
  render: () => <InteractionContextMenu onClose={() => {}} {...sharedProps} />,
  parameters: { colorScheme: "light" },
};

export const Dark: StoryObj = {
  render: () => <InteractionContextMenu onClose={() => {}} {...sharedProps} />,
  parameters: { colorScheme: "dark" },
};
