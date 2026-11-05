// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()((theme) => ({
  overlayStyle: {
    position: "absolute",
    zIndex: 999,
    backgroundColor: theme.palette.background.default,
    width: "100%",
    height: "100%",
  },
}));
