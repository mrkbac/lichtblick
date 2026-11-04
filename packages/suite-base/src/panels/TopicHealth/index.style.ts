// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha } from "@mui/material/styles";
import { makeStyles } from "tss-react/mui";

import { fontMonospace } from "@lichtblick/theme";

export const useStyles = makeStyles()((theme) => {
  const statusColors = {
    ok: theme.palette.success.main,
    slow: theme.palette.warning.main,
    stale: theme.palette.error.main,
    unmeasured: theme.palette.text.disabled,
  };
  return {
    toolbar: {
      display: "flex",
      alignItems: "center",
      gap: theme.spacing(0.5),
      flex: "auto",
    },
    search: { flex: "auto", font: "inherit" },
    summary: {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: theme.spacing(0.5),
      padding: theme.spacing(0.75, 1),
      borderBottom: `1px solid ${theme.palette.divider}`,
    },
    chip: {
      font: "inherit",
      fontSize: theme.typography.caption.fontSize,
      fontVariantNumeric: "tabular-nums",
      cursor: "pointer",
      border: "1px solid currentColor",
      borderRadius: 12,
      padding: theme.spacing(0.125, 1),
      background: "transparent",
    },
    chipActive: { background: alpha(theme.palette.text.primary, 0.12) },
    error: {
      color: theme.palette.error.main,
      fontSize: theme.typography.caption.fontSize,
    },
    root: { flex: 1, overflow: "auto", minHeight: 0 },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      fontVariantNumeric: "tabular-nums",
      "& th": {
        position: "sticky",
        top: 0,
        zIndex: 1,
        textAlign: "left",
        fontWeight: 500,
        whiteSpace: "nowrap",
        color: theme.palette.text.secondary,
        background: theme.palette.background.paper,
        padding: theme.spacing(0.5, 1),
        borderBottom: `1px solid ${theme.palette.divider}`,
      },
      "& td": {
        padding: theme.spacing(0.25, 1),
        whiteSpace: "nowrap",
        borderBottom: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
      },
      "& tbody tr:hover": { background: theme.palette.action.hover },
    },
    number: {
      textAlign: "right !important" as "right",
      fontFamily: fontMonospace,
    },
    namespace: { color: theme.palette.text.secondary },
    namespaceButton: {
      display: "inline-flex",
      alignItems: "center",
      gap: theme.spacing(0.5),
      font: "inherit",
      color: "inherit",
      background: "none",
      border: "none",
      cursor: "pointer",
      padding: 0,
    },
    topicButton: {
      font: "inherit",
      fontFamily: fontMonospace,
      color: theme.palette.text.primary,
      background: "none",
      border: "none",
      cursor: "pointer",
      padding: 0,
      "&:hover": { textDecoration: "underline" },
    },
    schema: {
      marginLeft: theme.spacing(1),
      color: theme.palette.text.secondary,
      fontSize: theme.typography.caption.fontSize,
    },
    dot: {
      display: "inline-block",
      width: 8,
      height: 8,
      borderRadius: "50%",
      marginRight: theme.spacing(1),
      background: "currentColor",
    },
    ok: { color: statusColors.ok },
    slow: { color: statusColors.slow },
    stale: { color: statusColors.stale },
    unmeasured: { color: statusColors.unmeasured },
    expected: {
      font: "inherit",
      width: "9ch",
      "& input": { textAlign: "right", padding: 0 },
    },
    muted: { color: theme.palette.text.secondary },
    sparkline: {
      width: 80,
      height: 16,
      verticalAlign: "middle",
      "& polyline": {
        fill: "none",
        stroke: theme.palette.primary.main,
        strokeWidth: 1.5,
        vectorEffect: "non-scaling-stroke",
      },
    },
    actions: { textAlign: "right", "& .MuiIconButton-root": { padding: 2 } },
  };
});
