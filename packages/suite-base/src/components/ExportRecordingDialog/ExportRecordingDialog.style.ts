// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()((theme) => ({
  grow: { flex: 1 },
  // Tall dialog whose topic table takes the remaining height, so only the table scrolls.
  paper: { height: "100%" },
  content: { display: "flex", flexDirection: "column" },
  fill: { flex: 1, minHeight: 0 },
  // Vertically centered on the 29px inputs next to it.
  rangeSummary: { paddingBottom: 6 },
  wrap: { wordBreak: "break-all" },
  everyNth: { width: 64 },
  compression: { minWidth: 160 },
  timeField: { width: 190 },
  count: { whiteSpace: "nowrap" },
  countTotal: { color: theme.palette.text.secondary },
  inactive: {
    "& .MuiTableCell-root": { color: theme.palette.text.disabled },
  },
  actions: {
    gap: theme.spacing(1),
    padding: theme.spacing(1, 3, 2),
    flexWrap: "wrap",
  },
}));
