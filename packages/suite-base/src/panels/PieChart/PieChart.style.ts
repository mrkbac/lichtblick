// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// SPDX-FileCopyrightText: Copyright (C) 2025 Takayuki Honda <takayuki.honda@tier4.jp>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()(() => ({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    width: "100%",
    overflow: "hidden",
    padding: 8,
  },
  title: {
    margin: "0 0 4px",
    textAlign: "center",
    fontSize: 13,
    fontWeight: 600,
  },
  chart: {
    position: "relative",
    flex: "1 1 0",
    minHeight: 0,
  },
  empty: {
    margin: "auto",
  },
}));
