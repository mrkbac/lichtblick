// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()((theme) => ({
  leftNav: {
    boxSizing: "content-box",
    borderRight: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.paper,
  },
  tabs: {
    flexGrow: 1,

    ".MuiTabs-flexContainerVertical": {
      height: "100%",
    },
  },
  tab: {
    padding: theme.spacing(1.625),
    minWidth: 50,
  },
  badge: {
    "> *:not(.MuiBadge-badge)": {
      width: "1.5rem",
      height: "1.5rem",
      fontSize: "1.5rem",
      display: "flex",

      ".root-span": {
        display: "contents",
      },
      svg: {
        fontSize: "inherit",
        width: "auto",
        height: "auto",
      },
    },
  },
  children: {
    flex: "1 1 0",
    minWidth: 0,
    // One grid cell stretches the content to the full width and height.
    display: "grid",
    gridTemplate: "minmax(0, 1fr) / minmax(0, 1fr)",
    overflow: "hidden",
  },
  sidebar: {
    flex: "none",
    minWidth: 0,
    display: "grid",
    gridTemplate: "minmax(0, 1fr) / minmax(0, 1fr)",
    overflow: "hidden",
  },
  resizeHandle: {
    flex: "none",
    width: 1,
    cursor: "col-resize",
    backgroundColor: theme.palette.divider,
    position: "relative",
    zIndex: 1,
    touchAction: "none",

    // A wider invisible hit area around the 1px line
    "&::before": {
      content: "''",
      position: "absolute",
      inset: "0 -3px",
    },
    "&:hover, &:active": {
      backgroundColor: theme.palette.primary.main,
    },
  },
}));
