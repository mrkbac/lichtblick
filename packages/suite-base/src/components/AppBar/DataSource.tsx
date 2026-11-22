// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Dismiss16Regular } from "@fluentui/react-icons";
import { IconButton, Tooltip } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import LichtblickLogoText from "@lichtblick/suite-base/components/LichtblickLogoText";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  selectPlayerName,
  selectPlayerPresence,
  selectSeekPlayback,
} from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { PlayerStatusPill } from "@lichtblick/suite-base/components/PlayerStatus/PlayerStatusPill";
import Stack from "@lichtblick/suite-base/components/Stack";
import TextMiddleTruncate from "@lichtblick/suite-base/components/TextMiddleTruncate";
import WssErrorModal from "@lichtblick/suite-base/components/WssErrorModal";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";

import { EndTimestamp } from "./EndTimestamp";

const useStyles = makeStyles()((theme) => ({
  sourceName: {
    font: "inherit",
    fontSize: theme.typography.body2.fontSize,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
    padding: theme.spacing(1.5),
    paddingInlineEnd: theme.spacing(0.75),
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  logo: {
    display: "block",
    width: 112,
    height: 28,
  },
  textTruncate: {
    maxWidth: "30vw",
    overflow: "hidden",
  },
}));

const selectPlayerAlerts = (ctx: MessagePipelineContext) => ctx.playerState.alerts;

export function DataSource(): React.JSX.Element {
  const { t } = useTranslation("appBar");
  const { classes } = useStyles();

  const playerName = useMessagePipeline(selectPlayerName);
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerAlerts = useMessagePipeline(selectPlayerAlerts) ?? [];
  const seek = useMessagePipeline(selectSeekPlayback);

  const { closeSource } = usePlayerSelection();

  // A crude but correct proxy (for our current architecture) for whether a connection is live
  const isLiveConnection = seek == undefined;

  const initializing = playerPresence === PlayerPresence.INITIALIZING;

  const playerDisplayName = initializing && playerName == undefined ? "Initializing…" : playerName;

  if (playerPresence === PlayerPresence.NOT_PRESENT) {
    return <LichtblickLogoText titleAccess={t("noDataSource")} className={classes.logo} />;
  }

  return (
    <>
      <WssErrorModal playerAlerts={playerAlerts} />
      <Stack direction="row" alignItems="center">
        <div className={classes.sourceName}>
          <div className={classes.textTruncate}>
            <TextMiddleTruncate text={playerDisplayName ?? `<${t("unknown")}>`} />
          </div>
          {isLiveConnection && (
            <>
              <span>/</span>
              <EndTimestamp />
            </>
          )}
        </div>
        <PlayerStatusPill />
        <Tooltip title={isLiveConnection ? t("disconnect") : t("closeDataSource")}>
          <IconButton
            color="inherit"
            size="small"
            aria-label={isLiveConnection ? t("disconnect") : t("closeDataSource")}
            onClick={closeSource}
          >
            <Dismiss16Regular />
          </IconButton>
        </Tooltip>
      </Stack>
    </>
  );
}
