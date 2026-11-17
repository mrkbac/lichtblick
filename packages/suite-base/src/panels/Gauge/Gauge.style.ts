// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()((theme) => ({
  root: {
    alignItems: "center",
    display: "flex",
    justifyContent: "center",
    height: "100%",
    width: "100%",
    overflow: "hidden",
    padding: 8,
    // The gauge fits the panel in both directions.
    containerType: "size",
  },
  gaugeWrapper: {
    flex: "none",
    position: "relative",
    // Text sizes follow the gauge's width.
    containerType: "inline-size",
    transform: "scale(1)", // Work around a Safari bug: https://bugs.webkit.org/show_bug.cgi?id=231849
  },
  track: {
    position: "absolute",
    inset: 0,
    backgroundColor: theme.palette.action.selected,
  },
  arc: {
    position: "absolute",
    inset: 0,
  },
  knob: {
    position: "absolute",
    aspectRatio: "1",
    borderRadius: "50%",
    transform: "translate(-50%, -50%)",
    backgroundColor: theme.palette.background.default,
    boxShadow: `0 0 0 0.6cqw ${theme.palette.text.primary}, 0 0.4cqw 1.6cqw rgb(0 0 0 / 0.35)`,
  },
  value: {
    position: "absolute",
    left: "50%",
    transform: "translate(-50%, -75%)",
    fontSize: "16cqw",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    color: theme.palette.text.primary,
  },
  outOfBounds: {
    color: theme.palette.warning.main,
  },
  limit: {
    position: "absolute",
    transform: "translateX(-50%)",
    fontSize: "5cqw",
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    color: theme.palette.text.secondary,
  },
}));
