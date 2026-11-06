// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  ErrorCircle20Regular,
  Info20Regular,
  CheckmarkCircle20Regular,
  Warning20Regular,
} from "@fluentui/react-icons";

import { alertClasses } from "@mui/material";

import { OverrideComponentReturn } from "../types";

export const MuiAlert: OverrideComponentReturn<"MuiAlert"> = {
  defaultProps: {
    iconMapping: {
      error: <ErrorCircle20Regular />,
      info: <Info20Regular />,
      success: <CheckmarkCircle20Regular />,
      warning: <Warning20Regular />,
    },
  },
  styleOverrides: {
    message: {
      lineHeight: "1.5",
    },
    standard: ({ theme }) => ({
      border: "1px solid",
      [`&.${alertClasses.colorWarning}`]: { borderColor: theme.palette.warning.main },
      [`&.${alertClasses.colorError}`]: { borderColor: theme.palette.error.main },
      [`&.${alertClasses.colorInfo}`]: { borderColor: theme.palette.info.main },
      [`&.${alertClasses.colorSuccess}`]: { borderColor: theme.palette.success.main },
    }),
  },
};
