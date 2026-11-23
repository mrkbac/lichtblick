// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AlarmOutlinedIcon from "@mui/icons-material/AlarmOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import ShoppingBagOutlinedIcon from "@mui/icons-material/ShoppingBagOutlined";
import { IconButtonProps, IconButton as MuiIconButton, Stack } from "@mui/material";
import { Meta, StoryObj } from "storybook-react-rsbuild";

const colors: IconButtonProps["color"][] = [
  "inherit",
  "primary",
  "secondary",
  "success",
  "error",
  "info",
  "warning",
];

export default {
  component: MuiIconButton,
  title: "Theme/Inputs/Icon Button",
  args: {},
} as Meta<typeof MuiIconButton>;

export const Default: StoryObj = {
  render: () => (
    <Stack
      direction="row"
      sx={{
        justifyContent: "center",
        alignItems: "center",
        padding: 2,
      }}
    >
      <MuiIconButton aria-label="delete">
        <DeleteOutlinedIcon fontSize="small" />
      </MuiIconButton>
      <MuiIconButton aria-label="delete" disabled color="primary">
        <DeleteOutlinedIcon fontSize="small" />
      </MuiIconButton>
      <MuiIconButton color="secondary" aria-label="add an alarm">
        <AlarmOutlinedIcon fontSize="small" />
      </MuiIconButton>
      <MuiIconButton color="primary" aria-label="add to shopping cart">
        <ShoppingBagOutlinedIcon fontSize="small" />
      </MuiIconButton>
    </Stack>
  ),
};

export const Sizes: StoryObj = {
  render: () => (
    <Stack
      direction="row"
      sx={{
        justifyContent: "center",
        alignItems: "center",
        padding: 2,
      }}
    >
      <MuiIconButton aria-label="delete" size="small">
        <DeleteOutlinedIcon style={{ fontSize: 12 }} />
      </MuiIconButton>
      <MuiIconButton aria-label="delete" size="small">
        <DeleteOutlinedIcon style={{ fontSize: 16 }} />
      </MuiIconButton>
      <MuiIconButton aria-label="delete" size="large">
        <DeleteOutlinedIcon fontSize="small" />
      </MuiIconButton>
      <MuiIconButton aria-label="delete" size="large">
        <DeleteOutlinedIcon style={{ fontSize: 28 }} />
      </MuiIconButton>
    </Stack>
  ),
};

export const Color: StoryObj = {
  render: () => (
    <Stack
      direction="row"
      sx={{
        justifyContent: "center",
        alignItems: "center",
        padding: 2,
      }}
    >
      {colors.map((color) => (
        <MuiIconButton {...{ color }} key={color}>
          <FingerprintIcon fontSize="small" />
        </MuiIconButton>
      ))}
    </Stack>
  ),
};
