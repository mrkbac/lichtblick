// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Fade, listSubheaderClasses } from "@mui/material";
import { dividerClasses } from "@mui/material/Divider";
import { listClasses } from "@mui/material/List";
import { listItemClasses } from "@mui/material/ListItem";

import { OverrideComponentReturn } from "../types";

export const MuiMenu: OverrideComponentReturn<"MuiMenu"> = {
  defaultProps: {
    slots: { transition: Fade },
  },
  styleOverrides: {
    paper: ({ theme }) => ({
      borderRadius: 8,
      backgroundColor: theme.palette.background.menu,
      border: `1px solid ${theme.palette.divider}`,
      boxShadow:
        theme.palette.mode === "dark"
          ? "0 12px 32px -8px rgb(0 0 0 / 0.6), 0 2px 6px rgb(0 0 0 / 0.3)"
          : "0 12px 32px -8px rgb(16 24 40 / 0.18), 0 2px 6px rgb(16 24 40 / 0.06)",
    }),
    list: ({ theme }) => ({
      ...theme.typography.body1,
      padding: theme.spacing(0.5),

      [`.${listItemClasses.root}, .MuiMenuItem-root`]: {
        borderRadius: theme.shape.borderRadius,
      },

      [`&.${listClasses.dense}`]: {
        ...theme.typography.body2,
      },
      [`.${listItemClasses.root} + .${dividerClasses.root}`]: {
        marginTop: theme.spacing(1),
        marginBottom: theme.spacing(1),
      },
      [`.${listSubheaderClasses.sticky}`]: {
        backgroundColor: theme.palette.background.menu,
      },
    }),
  },
};
