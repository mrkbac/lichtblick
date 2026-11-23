// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useTheme } from "@mui/material";

import { NotificationSeverity } from "@lichtblick/suite-base/util/sendNotification";

import { useStyles } from "./AlertsList.style";

export function AlertIcon({
  severity,
}: Readonly<{ severity: NotificationSeverity }>): React.JSX.Element {
  const { palette } = useTheme();
  const { classes } = useStyles();

  switch (severity) {
    case "warn":
      return (
        <WarningAmberIcon
          style={{ fontSize: 16 }}
          className={classes.icon}
          htmlColor={palette.warning.main}
        />
      );
    case "error":
      return (
        <ErrorOutlineOutlinedIcon
          style={{ fontSize: 16 }}
          className={classes.icon}
          htmlColor={palette.error.main}
        />
      );
    case "info":
      return (
        <InfoOutlinedIcon
          style={{ fontSize: 16 }}
          className={classes.icon}
          htmlColor={palette.info.main}
        />
      );
    default:
      return <></>;
  }
}
