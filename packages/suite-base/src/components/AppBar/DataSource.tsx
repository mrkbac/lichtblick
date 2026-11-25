// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { IconButton, Menu, MenuItem, Popover, Tooltip } from "@mui/material";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { DataSourceInfoView } from "@lichtblick/suite-base/components/DataSourceInfoView";
import LichtblickLogoText from "@lichtblick/suite-base/components/LichtblickLogoText";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  selectPlayerName,
  selectPlayerPresence,
} from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { PlayerStatusPill } from "@lichtblick/suite-base/components/PlayerStatus/PlayerStatusPill";
import { selectIsLive } from "@lichtblick/suite-base/components/PlayerStatus/usePlayerStatus";
import Stack from "@lichtblick/suite-base/components/Stack";
import TextMiddleTruncate from "@lichtblick/suite-base/components/TextMiddleTruncate";
import WssErrorModal from "@lichtblick/suite-base/components/WssErrorModal";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useShareLink } from "@lichtblick/suite-base/hooks/useShareLink";
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
  infoPaper: {
    padding: theme.spacing(1.5, 2),
    width: 340,
    maxHeight: "60vh",
    overflowY: "auto",
  },
  textTruncate: {
    maxWidth: "30vw",
    overflow: "hidden",
  },
}));

const selectPlayerAlerts = (ctx: MessagePipelineContext) => ctx.playerState.alerts;
const selectUrlParameters = (ctx: MessagePipelineContext) => ctx.playerState.urlState?.parameters;

/** Remote files of the source (`url` or `urls` param), which the browser can download directly. */
function remoteFileUrls(
  parameters: Readonly<Record<string, string | readonly string[]>> | undefined,
) {
  return [parameters?.url ?? [], parameters?.urls ?? []]
    .flat()
    .filter((url) => /^https?:\/\//.test(url));
}

export function DataSource(): React.JSX.Element {
  const { t } = useTranslation("appBar");
  const { classes } = useStyles();

  const playerName = useMessagePipeline(selectPlayerName);
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerAlerts = useMessagePipeline(selectPlayerAlerts) ?? [];
  const isLiveConnection = useMessagePipeline(selectIsLive);

  const urlParameters = useMessagePipeline(selectUrlParameters);
  const { availability: shareAvailability, copyLink } = useShareLink();
  const { closeSource } = usePlayerSelection();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<"menu" | "info" | undefined>();
  const close = () => {
    setOpen(undefined);
  };
  const downloadUrls = remoteFileUrls(urlParameters);

  const initializing = playerPresence === PlayerPresence.INITIALIZING;

  const playerDisplayName = initializing && playerName == undefined ? "Initializing…" : playerName;

  if (playerPresence === PlayerPresence.NOT_PRESENT) {
    return <LichtblickLogoText titleAccess={t("noDataSource")} className={classes.logo} />;
  }

  return (
    <>
      <WssErrorModal playerAlerts={playerAlerts} />
      <Stack direction="row" alignItems="center">
        <div className={classes.sourceName} ref={anchorRef}>
          <div className={classes.textTruncate}>
            <TextMiddleTruncate text={playerDisplayName ?? `<${t("unknown")}>`} />
          </div>
          {isLiveConnection && (
            <>
              <span>/</span>
              <EndTimestamp />
            </>
          )}
          <IconButton
            color="inherit"
            size="small"
            aria-label={t("dataSourceActions")}
            aria-haspopup="menu"
            aria-expanded={open === "menu"}
            onClick={() => {
              setOpen("menu");
            }}
          >
            <ExpandMoreIcon style={{ fontSize: 16 }} />
          </IconButton>
        </div>
        <Menu
          open={open === "menu"}
          anchorEl={anchorRef.current}
          onClose={close}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          {shareAvailability === "link" && (
            <MenuItem
              onClick={() => {
                close();
                void copyLink();
              }}
            >
              {t("copyLink")}
            </MenuItem>
          )}
          {downloadUrls.map((url) => (
            <MenuItem
              key={url}
              component="a"
              href={url}
              target="_blank"
              rel="noreferrer"
              download
              onClick={close}
            >
              {downloadUrls.length === 1
                ? t("download")
                : t("downloadFile", { name: url.split("/").pop() ?? url })}
            </MenuItem>
          ))}
          <MenuItem
            onClick={() => {
              setOpen("info");
            }}
          >
            {t("viewDataSourceInfo")}
          </MenuItem>
        </Menu>
        <Popover
          open={open === "info"}
          anchorEl={anchorRef.current}
          onClose={close}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          slotProps={{ paper: { className: classes.infoPaper } }}
        >
          <DataSourceInfoView disableSource />
        </Popover>
        <PlayerStatusPill />
        <Tooltip title={isLiveConnection ? t("disconnect") : t("closeDataSource")}>
          <IconButton
            color="inherit"
            size="small"
            aria-label={isLiveConnection ? t("disconnect") : t("closeDataSource")}
            onClick={closeSource}
          >
            <CloseIcon style={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Stack>
    </>
  );
}
