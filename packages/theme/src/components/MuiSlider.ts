// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { OverrideComponentReturn } from "../types";

// MUI's default value label uses grey[600], which in the dark palette is the same
// colour as the sidebar background. Invert text/background so it reads in both themes.
export const MuiSlider: OverrideComponentReturn<"MuiSlider"> = {
  styleOverrides: {
    valueLabel: ({ theme }) => ({
      backgroundColor: theme.palette.text.primary,
      color: theme.palette.background.paper,
      fontSize: theme.typography.caption.fontSize,
    }),
  },
};
