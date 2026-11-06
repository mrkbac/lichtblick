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
    tableLayout: "fixed",
    width: "100%",
    fontFamily: fontMonospace,
    fontSize: theme.typography.caption.fontSize,
    fontVariantNumeric: "tabular-nums",

    "th, td": {
      padding: theme.spacing(0.25, 1),
      whiteSpace: "nowrap",
      textAlign: "right",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    "th:first-of-type, td:first-of-type": {
      textAlign: "left",
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
  groupStart: {
    paddingLeft: `${theme.spacing(2.5)} !important`,
  },
  frameCell: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
    minWidth: 0,
  },
  frameName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
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
  /** Tooltip text with one item per line */
  multiline: {
    whiteSpace: "pre-line",
    display: "block",
    // Long warning lists scroll inside the tooltip, which stays open while hovered
    maxHeight: "50vh",
    overflowY: "auto",
  },
  warningIcon: {
    color: theme.palette.warning.main,
    display: "inline-flex",
    flex: "none",
  },
  selectableRow: {
    cursor: "pointer",
    "&:focus-visible": {
      outline: `1px solid ${theme.palette.primary.main}`,
      outlineOffset: -1,
    },
  },
  selectedRow: {
    backgroundColor: `${theme.palette.action.selected} !important`,
  },
  adjusted: {
    color: theme.palette.info.main,
  },
  adjustedBadge: {
    flex: "none",
    color: theme.palette.info.main,
    fontSize: theme.typography.caption.fontSize,
  },
  editor: {
    flex: "none",
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.5, 1),
    borderTop: `1px solid ${theme.palette.divider}`,
  },
  editorHeader: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  editorTitle: {
    flex: "auto",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 600,
  },
  stepButton: {
    padding: theme.spacing(0, 1),
    textTransform: "none",
  },
  editorGrid: {
    display: "grid",
    gridTemplateColumns: "max-content repeat(3, minmax(0, 1fr))",
    gap: theme.spacing(0.25),
    alignItems: "center",
    "& > *": { minWidth: 0 },
  },
  editorColumn: {
    textAlign: "center",
    color: theme.palette.text.secondary,
    fontSize: theme.typography.caption.fontSize,
  },
  editorLabel: {
    paddingRight: theme.spacing(1),
    color: theme.palette.text.secondary,
  },
  editorActions: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
  },
  spacer: {
    flex: "auto",
  },
  infoIcon: {
    display: "inline-flex",
    verticalAlign: "middle",
    marginRight: theme.spacing(0.25),
    color: theme.palette.text.secondary,
    cursor: "help",
    "& svg": { width: 12, height: 12 },
  },
}));
