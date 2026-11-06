// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

import { fontMonospace } from "@lichtblick/theme";

export const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    flex: "auto",
    minHeight: 0,
    position: "relative",
    containerType: "inline-size",
  },
  list: { flex: "auto", overflow: "auto", minHeight: 0 },
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    minHeight: 26,
    padding: theme.spacing(0, 0.5, 0, 1),
    borderBottom: `1px solid ${theme.palette.divider}`,
    fontSize: theme.typography.body2.fontSize,
    "&:hover": { backgroundColor: theme.palette.action.hover },
    "&:hover [data-actions], &:focus-within [data-actions]": { visibility: "visible" },
    // The expand toggle only applies to arrays and objects; set while painting values
    // Stays visible while expanded, so a value that turned scalar can still be collapsed
    "&[data-expandable='false'][data-expanded='false'] [data-expand]": { visibility: "hidden" },
    "&[data-error='true'] [data-value]": { color: theme.palette.error.main },
    // Frozen values: dim the value, highlight the age
    "&[data-stale='true'] [data-value]": { color: theme.palette.text.disabled },
    "&[data-stale='true'] [data-age]": { color: theme.palette.warning.main },
  },
  dropTarget: { boxShadow: `inset 0 2px 0 ${theme.palette.primary.main}` },
  expandButton: { padding: 0, margin: theme.spacing(0, -0.5) },
  name: {
    flex: "0 1 40%",
    minWidth: 60,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
    color: theme.palette.text.secondary,
    "&:hover": { color: theme.palette.primary.main, textDecoration: "underline" },
  },
  invalid: { color: theme.palette.error.main },
  value: {
    flex: "1 1 0",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "right",
    fontFamily: fontMonospace,
    fontVariantNumeric: "tabular-nums",
  },
  unit: { color: theme.palette.text.secondary, whiteSpace: "nowrap" },
  age: {
    flex: "none",
    minWidth: 44,
    textAlign: "right",
    color: theme.palette.text.secondary,
    fontSize: theme.typography.caption.fontSize,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    "@container (max-width: 220px)": { display: "none" },
  },
  sparkline: {
    width: 64,
    height: 18,
    flex: "none",
    "@container (max-width: 280px)": { display: "none" },
  },
  // Overlays the end of the row on hover, so it takes no space from values
  actions: {
    visibility: "hidden",
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    paddingLeft: theme.spacing(0.5),
    backgroundColor: theme.palette.background.paper,
    "& button": { padding: 2 },
  },
  expanded: {
    margin: 0,
    padding: theme.spacing(0.5, 1, 0.5, 4),
    maxHeight: 300,
    overflow: "auto",
    fontFamily: fontMonospace,
    fontSize: theme.typography.caption.fontSize,
    borderBottom: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.default,
    whiteSpace: "pre",
  },
  addRow: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.5, 1),
    borderTop: `1px solid ${theme.palette.divider}`,
  },
  addInput: { flex: "auto", minWidth: 0 },
  empty: {
    padding: theme.spacing(2),
    color: theme.palette.text.secondary,
    textAlign: "center",
  },
}));
