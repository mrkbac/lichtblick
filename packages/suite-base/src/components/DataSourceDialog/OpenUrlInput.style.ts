// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

import { fontMonospace } from "@lichtblick/theme";

export const useStyles = makeStyles()((theme) => ({
  input: {
    flex: "auto",
    minWidth: 0,
    // Match the buttons' height, which the row stretches to
    "& .MuiInputBase-root": { height: "100%" },
  },
  adornment: {
    gap: theme.spacing(0.5),
    maxWidth: "60%",
  },
  topMatch: {
    minWidth: 0,
  },
  button: {
    flex: "none",
    whiteSpace: "nowrap",
  },
  help: {
    padding: theme.spacing(0.5),
  },
  helpTooltip: {
    maxWidth: 420,
  },
  code: {
    fontFamily: fontMonospace,
  },
}));
