// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

import { fontMonospace } from "@lichtblick/theme";

export const useStyles = makeStyles()((theme) => ({
  summary: {
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing(1),
    alignItems: "center",
    padding: theme.spacing(0.5, 1),
    color: theme.palette.text.secondary,
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  warningText: {
    color: theme.palette.warning.main,
    display: "inline-flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
  },
  scroll: {
    overflow: "auto",
    flex: "auto",
  },
  table: {
    borderCollapse: "collapse",
    width: "100%",
    fontFamily: fontMonospace,
    fontSize: theme.typography.caption.fontSize,
    fontVariantNumeric: "tabular-nums",

    "th, td": {
      padding: theme.spacing(0.25, 1),
      whiteSpace: "pre",
      textAlign: "right",
    },
    "th:first-of-type, td:first-of-type": {
      textAlign: "left",
      width: "100%",
    },
    th: {
      position: "sticky",
      top: 0,
      zIndex: 1,
      fontWeight: 500,
      color: theme.palette.text.secondary,
      backgroundColor: theme.palette.background.paper,
      borderBottom: `1px solid ${theme.palette.divider}`,
    },
    "tbody tr:hover": {
      backgroundColor: theme.palette.action.hover,
    },
  },
  frameCell: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
  },
  toggle: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 12,
    flex: "none",
    padding: 0,
    border: "none",
    background: "none",
    color: "inherit",
    cursor: "pointer",
  },
  togglePlaceholder: {
    width: 16,
    flex: "none",
  },
  root: {
    fontWeight: 600,
  },
  muted: {
    color: theme.palette.text.disabled,
  },
  warningRow: {
    backgroundColor: theme.palette.warning.main + "1a",
  },
  staticBadge: {
    color: theme.palette.text.secondary,
  },
  warningIcon: {
    color: theme.palette.warning.main,
    flex: "none",
  },
}));
