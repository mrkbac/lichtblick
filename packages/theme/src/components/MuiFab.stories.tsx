// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import FavoriteIcon from "@mui/icons-material/Favorite";
import HomeRepairServiceIcon from "@mui/icons-material/HomeRepairService";
import { Fab, FabProps, Stack } from "@mui/material";
import { Meta, StoryObj } from "storybook-react-rsbuild";

const variants: FabProps["variant"][] = ["circular", "extended"];
const sizes: FabProps["size"][] = ["small", "medium", "large"];
const colors: FabProps["color"][] = [
  "inherit",
  "primary",
  "secondary",
  "success",
  "error",
  "info",
  "warning",
];

export default {
  component: Fab,
  title: "Theme/Inputs/Floating Action Button",
  decorators: [
    (Story) => {
      return (
        <Stack
          direction="row"
          sx={{
            padding: 2,
            gap: 2,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Story />
        </Stack>
      );
    },
  ],
  parameters: {
    colorScheme: "both-column",
  },
} as Meta;

export const Default: StoryObj = {
  render: () => (
    <>
      <Fab color="primary" aria-label="add">
        <AddIcon fontSize="small" />
      </Fab>
      <Fab color="secondary" aria-label="edit">
        <EditIcon fontSize="small" />
      </Fab>
      <Fab variant="extended">
        <HomeRepairServiceIcon fontSize="small" />
        Tools
      </Fab>
      <Fab disabled aria-label="like">
        <FavoriteIcon fontSize="small" />
      </Fab>
    </>
  ),
};

export const Colors: StoryObj = {
  render: () => (
    <>
      {colors.map((color) => (
        <Fab key={color} color={color} aria-label={color}>
          <AddIcon fontSize="small" />
        </Fab>
      ))}
    </>
  ),
};

export const SizesAndVariants: StoryObj = {
  render: () => (
    <Stack
      sx={{
        gap: 2,
        alignItems: "center",
      }}
    >
      {variants.map((variant) => (
        <Stack
          key={variant}
          direction="row"
          sx={{
            alignItems: "center",
            gap: 2,
          }}
        >
          {sizes.map((size) => (
            <Fab color="primary" key={size} {...{ size, variant }}>
              <AddIcon fontSize="small" />
              {variant === "extended" && "Extended"}
            </Fab>
          ))}
        </Stack>
      ))}
    </Stack>
  ),
};
