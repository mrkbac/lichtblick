// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()(() => ({
  tooltip: {
    maxWidth: "none",
  },
  canvasDiv: { width: "100%", height: "100%", overflow: "hidden", cursor: "crosshair" },
  canvasDivPointer: { cursor: "pointer" },
  verticalBarWrapper: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    position: "relative",
  },
}));
