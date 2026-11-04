// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { alpha, iconButtonClasses } from "@mui/material";
import { keyframes } from "tss-react";
import { makeStyles } from "tss-react/mui";

export const VALUE_FLASH_MS = 2000;

export const useStyles = makeStyles()((theme) => {
  const flash = keyframes`
    from { background-color: ${alpha(theme.palette.warning.main, 0.35)}; }
    to { background-color: transparent; }
  `;
  return {
    root: {
      position: "relative",
      flex: "auto",
      overflow: "hidden",
      display: "flex",
    },
    scroller: {
      flex: "auto",
      overflowY: "auto",
      contain: "strict",
    },
    resizeHandle: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: 12,
      marginLeft: -6,
      cursor: "col-resize",
      zIndex: 1,

      "&:hover, &:active, &:focus": {
        outline: "none",

        "&::after": {
          content: '""',
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 6,
          marginLeft: -2,
          width: 4,
          backgroundColor: theme.palette.action.focus,
        },
      },
    },
    row: {
      position: "absolute",
      left: 0,
      width: "100%",
      display: "grid",
      borderBottom: `1px solid ${theme.palette.divider}`,
      fontSize: theme.typography.body2.fontSize,
      lineHeight: theme.typography.body2.lineHeight,

      "&:hover": { backgroundColor: theme.palette.action.hover },
      "@media (pointer: fine)": {
        [`.${iconButtonClasses.root}`]: { visibility: "hidden" },
        [`&:hover .${iconButtonClasses.root}`]: { visibility: "visible" },
      },
    },
    headerRow: {
      backgroundColor: theme.palette.background.paper,
    },
    cell: {
      display: "flex",
      alignItems: "center",
      gap: theme.spacing(0.5),
      minWidth: 0,
      padding: theme.spacing(0.25, 1),
      overflowWrap: "anywhere",
    },
    fullWidth: { gridColumn: "1 / -1" },
    keyCell: { borderRight: `1px solid ${theme.palette.divider}` },
    valueText: { flex: "auto", minWidth: 0 },
    flash: { animation: `${flash} ${VALUE_FLASH_MS}ms ease-out` },
    htmlCell: {
      "h1, h2, h3, h4, h5, h6": {
        fontFamily: theme.typography.subtitle2.fontFamily,
        fontSize: theme.typography.subtitle2.fontSize,
        lineHeight: theme.typography.subtitle2.lineHeight,
        letterSpacing: theme.typography.subtitle2.letterSpacing,
        fontWeight: 800,
        margin: 0,
      },
    },
    iconButton: {
      padding: 2,
      "&:hover, &:active, &:focus": {
        backgroundColor: "transparent",
      },
    },
  };
});
