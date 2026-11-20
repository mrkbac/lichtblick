// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { alpha } from "@mui/material";
import { makeStyles } from "tss-react/mui";

import { fontMonospace } from "@lichtblick/theme";

export const useStylesPanelLogs = makeStyles()((theme) => {
  const levelColor = {
    error: theme.palette.error.main,
    warn: theme.palette.warning.main,
    info: theme.palette.info.main,
    debug: theme.palette.text.secondary,
  };
  const chip = (color: string) => ({
    backgroundColor: alpha(color, 0.16),
    color,
    "&:hover": { backgroundColor: alpha(color, 0.24) },
  });
  const row = (color: string, tint: number) => ({
    borderLeftColor: color,
    backgroundColor: tint > 0 ? alpha(color, tint) : undefined,
  });

  return {
    root: {
      background: theme.palette.background.paper,
      borderTop: `1px solid ${theme.palette.divider}`,
      position: "relative",
      display: "flex",
      flexDirection: "column",
      minHeight: 120,
      maxHeight: 600,
    },
    resizeHandle: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 8,
      cursor: "ns-resize",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
      zIndex: 1,
      "&:hover": {
        backgroundColor: theme.palette.action.hover,
      },
      "&:hover .MuiSvgIcon-root": {
        opacity: 1,
      },
    },
    resizeIcon: {
      fontSize: "1rem",
      opacity: 0.3,
      transition: theme.transitions.create("opacity", {
        duration: theme.transitions.duration.short,
      }),
      transform: "rotate(90deg)",
      color: theme.palette.text.secondary,
    },
    header: {
      display: "flex",
      alignItems: "center",
      gap: theme.spacing(1),
      padding: theme.spacing(1, 0.5, 0.5, 1.5),
      borderBottom: `1px solid ${theme.palette.divider}`,
      flexShrink: 0,
    },
    title: {
      whiteSpace: "nowrap",
    },
    filters: {
      display: "flex",
      flexWrap: "wrap",
      gap: theme.spacing(0.5),
      flex: 1,
      minWidth: 0,
    },
    chip: {
      height: 20,
      fontSize: theme.typography.caption.fontSize,
      fontWeight: 600,
      letterSpacing: "0.02em",
      "& .MuiChip-label": { padding: theme.spacing(0, 0.75) },
    },
    errorChip: chip(levelColor.error),
    warnChip: chip(levelColor.warn),
    infoChip: chip(levelColor.info),
    debugChip: chip(levelColor.debug),
    actions: {
      display: "flex",
      flexShrink: 0,
    },
    listContainer: {
      flex: 1,
      overflowY: "auto",
      fontFamily: fontMonospace,
      fontSize: theme.typography.caption.fontSize,
      lineHeight: 1.5,
    },
    empty: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing(0.5),
      height: "100%",
      padding: theme.spacing(2),
      fontFamily: theme.typography.fontFamily,
      textAlign: "center",
    },
    row: {
      display: "flex",
      alignItems: "baseline",
      gap: theme.spacing(1),
      padding: theme.spacing(0.5, 1.5, 0.5, 1),
      borderLeft: "3px solid transparent",
      borderBottom: `1px solid ${theme.palette.divider}`,
      "&:hover": { backgroundColor: theme.palette.action.hover },
    },
    errorRow: row(levelColor.error, 0.08),
    warnRow: row(levelColor.warn, 0.08),
    infoRow: row(levelColor.info, 0),
    debugRow: row("transparent", 0),
    level: {
      flexShrink: 0,
      width: "5ch",
      fontWeight: 600,
    },
    error: { color: levelColor.error },
    warn: { color: levelColor.warn },
    info: { color: levelColor.info },
    debug: { color: levelColor.debug },
    body: {
      flex: 1,
      minWidth: 0,
    },
    message: {
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      userSelect: "text",
    },
    details: {
      marginTop: theme.spacing(0.25),
      "& > summary": {
        cursor: "pointer",
        color: theme.palette.text.secondary,
        width: "fit-content",
      },
    },
    stack: {
      margin: theme.spacing(0.5, 0, 0),
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      color: theme.palette.text.secondary,
      fontSize: "0.9em",
    },
    repeat: {
      flexShrink: 0,
      padding: theme.spacing(0, 0.5),
      borderRadius: theme.shape.borderRadius,
      backgroundColor: theme.palette.action.selected,
      color: theme.palette.text.secondary,
    },
    time: {
      flexShrink: 0,
      color: theme.palette.text.secondary,
    },
  };
});
