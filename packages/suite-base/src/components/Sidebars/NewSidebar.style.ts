// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()((theme) => ({
  root: {
    boxSizing: "content-box",
    backgroundColor: theme.palette.background.paper,
  },
  badgeRoot: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  badge: {
    fontSize: theme.typography.caption.fontSize,
    lineHeight: 0,
    borderRadius: 8,
    transform: "none",
    position: "relative",
  },
  badgeInvisible: {
    display: "none",
  },
  anchorRight: {
    borderLeft: `1px solid ${theme.palette.divider}`,
  },
  anchorLeft: {
    borderRight: `1px solid ${theme.palette.divider}`,
  },
  tabs: {
    minHeight: "auto",
    flex: "1 1 auto",
    overflow: "hidden",
    paddingLeft: theme.spacing(0.25),

    // Panel tabs as in VS Code's modern UI: small uppercase labels; the active tab is a rounded,
    // bordered pill instead of an underline.
    ".MuiTabs-indicator": {
      display: "none",
    },
    ".MuiTab-root": {
      minHeight: 22,
      minWidth: theme.spacing(4),
      margin: theme.spacing(0.5, 0.25),
      padding: theme.spacing(0, 0.75),
      color: theme.palette.text.secondary,
      fontSize: "0.6875rem",
      fontWeight: 500,
      textTransform: "uppercase",
      letterSpacing: "0.02em",
      border: "1px solid transparent",
      borderRadius: 4,

      "&:hover": {
        backgroundColor: theme.palette.action.hover,
      },
      "&.Mui-selected": {
        color: theme.palette.text.primary,
        backgroundColor: theme.palette.background.default,
        borderColor: theme.palette.divider,
      },
    },
  },
  iconButton: {
    padding: theme.spacing(0.91125), // round out the overall height to 30px
    color: theme.palette.text.secondary,
    borderRadius: theme.shape.borderRadius,

    ":hover": {
      color: theme.palette.text.primary,
    },
  },
  tabContent: {
    flex: "auto",
    overflow: "auto",
  },
}));
