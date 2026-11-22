// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ErrorCircle20Regular, PlugDisconnected20Regular } from "@fluentui/react-icons";
import { Button, CircularProgress, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { PANEL_TOOLBAR_HEIGHT } from "@lichtblick/suite-base/components/PanelToolbar/constants";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";

import { usePlayerStatus, useRetrySource } from "./usePlayerStatus";

const useStyles = makeStyles()((theme) => ({
  root: {
    position: "absolute",
    top: PANEL_TOOLBAR_HEIGHT,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    backgroundColor: theme.palette.background.paper,
    padding: theme.spacing(1.5),
    overflow: "hidden",
    textAlign: "center",
    containerType: "size",
  },
  // Only in panels with room for it: small panels show the title and the main button.
  extra: {
    "@container (max-height: 220px) or (max-width: 220px)": {
      display: "none",
    },
  },
  errorIcon: {
    color: theme.palette.error.main,
    flex: "none",
  },
  // Very small panels keep only the title and the button.
  tinyHidden: {
    "@container (max-height: 130px)": {
      display: "none",
    },
  },
  detail: {
    maxWidth: 360,
    wordBreak: "break-word",
  },
}));

/**
 * Covers a panel's content while its data source is connecting, loading or broken, so panels
 * don't each show "topic not found" or a blank canvas for what is really a player state. Renders
 * nothing once data is flowing; from then on the panel's own empty states are accurate.
 */
export function PanelPlayerState(): React.ReactNode {
  const { t } = useTranslation("panelPlayerState");
  const { classes, cx } = useStyles();
  const status = usePlayerStatus();
  const retry = useRetrySource();
  const { dialogActions, sidebarActions } = useWorkspaceActions();

  const showDetails = () => {
    sidebarActions.left.setOpen(true);
    sidebarActions.left.selectItem("alerts");
  };

  let content: React.ReactNode;
  switch (status.kind) {
    case "none":
      content = (
        <>
          <Typography variant="body2" color="text.secondary">
            {t("noSource")}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            className={classes.extra}
            onClick={() => {
              dialogActions.dataSource.open("start");
            }}
          >
            {t("openSource")}
          </Button>
        </>
      );
      break;
    case "connecting":
    case "opening":
    case "loading":
      content = (
        <>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary" className={classes.detail}>
            {t(status.kind)}
          </Typography>
        </>
      );
      break;
    case "reconnecting":
    case "failed":
      if (status.kind === "reconnecting" && status.hasData) {
        // Keep showing the last data; the app bar says it's reconnecting.
        return undefined;
      }
      content = (
        <>
          <span className={classes.tinyHidden}>
            {status.kind === "failed" ? (
              <ErrorCircle20Regular className={classes.errorIcon} />
            ) : (
              <PlugDisconnected20Regular />
            )}
          </span>
          <Typography variant="body2">
            {t(status.kind === "failed" ? "failed" : "cannotConnect")}
          </Typography>
          {status.error != undefined && (
            <Typography
              variant="caption"
              color="text.secondary"
              className={cx(classes.detail, classes.extra)}
            >
              {status.error.message}
            </Typography>
          )}
          {status.kind === "reconnecting" && (
            <Typography variant="caption" color="text.secondary" className={classes.extra}>
              {t("retrying")}
            </Typography>
          )}
          <Stack direction="row" gap={1} flexWrap="wrap" justifyContent="center">
            {retry != undefined && (
              <Button size="small" variant="contained" onClick={retry}>
                {t(status.kind === "failed" ? "retry" : "retryNow")}
              </Button>
            )}
            <Button size="small" variant="outlined" onClick={showDetails} className={classes.extra}>
              {t("details")}
            </Button>
          </Stack>
        </>
      );
      break;
    case "live":
    case "ready":
      return undefined;
  }

  return (
    <Stack
      className={classes.root}
      alignItems="center"
      justifyContent="center"
      gap={1}
      data-testid="panel-player-state"
    >
      {content}
    </Stack>
  );
}
