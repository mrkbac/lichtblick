// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1.5),
    minWidth: 0,
    flex: "auto",
  },
  icon: {
    display: "flex",
    flex: "none",
    color: theme.palette.primary.main,
  },
  text: {
    minWidth: 0,
    flex: "auto",
  },
  pin: {
    flex: "none",
    color: theme.palette.text.secondary,
  },
}));
