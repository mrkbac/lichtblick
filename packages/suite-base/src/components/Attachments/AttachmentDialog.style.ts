// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

import { fontMonospace } from "@lichtblick/theme";

export const useStyles = makeStyles()((theme) => ({
  content: {
    display: "flex",
    justifyContent: "center",
    minHeight: 160,
  },
  media: {
    maxWidth: "100%",
    maxHeight: "70vh",
    objectFit: "contain",
  },
  note: {
    marginRight: "auto",
    marginLeft: theme.spacing(2),
  },
  pdf: {
    width: "100%",
    height: "70vh",
    border: "none",
  },
  code: {
    margin: 0,
    width: "100%",
    maxHeight: "70vh",
    overflow: "auto",
    padding: theme.spacing(1),
    fontFamily: fontMonospace,
    fontSize: theme.typography.caption.fontSize,
    backgroundColor: theme.palette.action.hover,
    borderRadius: theme.shape.borderRadius,
    whiteSpace: "pre",
  },
}));
