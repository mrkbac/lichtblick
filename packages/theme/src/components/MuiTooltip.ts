// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Fade, alpha } from "@mui/material";

import { OverrideComponentReturn } from "../types";

export const MuiTooltip: OverrideComponentReturn<"MuiTooltip"> = {
  defaultProps: {
    arrow: true,
    // oxlint-disable-next-line typescript/no-deprecated -- MUI deprecated theme default prop; migrate to slots/slotProps separately
    TransitionComponent: Fade,
  },
  styleOverrides: {
    arrow: ({ theme }) => ({
      color: alpha(theme.palette.grey[700], 0.92),
      backdropFilter: "blur(3px)",
    }),
    tooltip: ({ theme }) => ({
      backgroundColor: alpha(theme.palette.grey[700], 0.92),
      backdropFilter: "blur(3px)",
      fontWeight: "normal",
      fontSize: theme.typography.caption.fontSize,
    }),
  },
};
