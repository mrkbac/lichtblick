// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useTheme } from "@mui/material";

import { NotificationSeverity } from "@lichtblick/suite-base/util/sendNotification";

import { useStyles } from "./AlertsList.style";

const SEVERITY_ICONS = {
  warn: { Icon: WarningAmberIcon, color: "warning" },
  error: { Icon: ErrorOutlineOutlinedIcon, color: "error" },
  info: { Icon: InfoOutlinedIcon, color: "info" },
} as const;

export function AlertIcon({
  severity,
}: Readonly<{ severity: NotificationSeverity }>): React.JSX.Element {
  const { palette } = useTheme();
  const { classes } = useStyles();
  // Alerts can come from extensions, so the severity is not guaranteed at runtime.
  const entry = SEVERITY_ICONS[severity] as
    | (typeof SEVERITY_ICONS)[NotificationSeverity]
    | undefined;
  if (entry == undefined) {
    return <></>;
  }
  const { Icon, color } = entry;
  return <Icon style={{ fontSize: 16 }} className={classes.icon} htmlColor={palette[color].main} />;
}
