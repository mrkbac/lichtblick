// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()((theme) => ({
  menuList: {
    minWidth: 240,
    maxWidth: 300,
  },
  menuItem: {
    justifyContent: "space-between",
    gap: theme.spacing(2),
    kbd: {
      font: "inherit",
      color: theme.palette.text.disabled,
    },
  },
  subheader: {
    lineHeight: 2.5,
    backgroundColor: "transparent",
  },
}));
