// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import ErrorIcon from "@mui/icons-material/Error";
import { ButtonBase, CircularProgress, Tooltip } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";

import { PlayerStatusKind, usePlayerStatus } from "./usePlayerStatus";

const useStyles = makeStyles()((theme) => ({
  pill: {
    display: "flex",
    alignItems: "center",
    flex: "none",
    gap: theme.spacing(0.5),
    height: 20,
    padding: theme.spacing(0, 0.75),
    borderRadius: 10,
    fontSize: theme.typography.caption.fontSize,
    fontWeight: 500,
    whiteSpace: "nowrap",
    color: theme.palette.appBar.text,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  warning: {
    color: theme.palette.warning.main,
  },
  error: {
    color: theme.palette.error.main,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    backgroundColor: theme.palette.success.main,
  },
  label: {
    [theme.breakpoints.down("md")]: {
      display: "none",
    },
  },
}));

const LABEL_KEYS = {
  connecting: "statusConnecting",
  opening: "statusOpening",
  loading: "statusLoading",
  reconnecting: "statusReconnecting",
  failed: "statusFailed",
  live: "statusLive",
  ready: "statusError",
} as const satisfies Partial<Record<PlayerStatusKind, string>>;

/** The data source's state in a word, next to its name in the app bar. Opens Alerts on click. */
export function PlayerStatusPill(): React.ReactNode {
  const { t } = useTranslation("appBar");
  const { classes, cx } = useStyles();
  const { kind, error } = usePlayerStatus();
  const { sidebarActions } = useWorkspaceActions();

  // A recording that is open and fine needs no badge.
  if (kind === "none" || (kind === "ready" && error == undefined)) {
    return undefined;
  }

  const busy = kind === "connecting" || kind === "opening" || kind === "loading";
  const label = t(LABEL_KEYS[kind]);
  return (
    <Tooltip title={error?.message ?? label}>
      <ButtonBase
        className={cx(classes.pill, {
          [classes.warning]: kind === "reconnecting",
          [classes.error]:
            kind === "failed" || ((kind === "ready" || kind === "live") && error != undefined),
        })}
        aria-label={label}
        data-testid="player-status-pill"
        onClick={() => {
          sidebarActions.left.setOpen(true);
          sidebarActions.left.selectItem("alerts");
        }}
      >
        {(busy || kind === "reconnecting") && <CircularProgress size={10} color="inherit" />}
        {(kind === "failed" || (kind === "ready" && error != undefined)) && (
          <ErrorIcon style={{ fontSize: 16 }} />
        )}
        {kind === "live" && error == undefined && <span className={classes.liveDot} />}
        {kind === "live" && error != undefined && <ErrorIcon style={{ fontSize: 16 }} />}
        <span className={classes.label}>{label}</span>
      </ButtonBase>
    </Tooltip>
  );
}
