// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()((theme) => ({
  speedText: {
    fontSize: "0.8rem",
    fontWeight: 400,
    marginRight: 2,
  },
  paper: {
    width: 280,
    padding: theme.spacing(1.5),
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(1),
  },
  value: {
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
}));
