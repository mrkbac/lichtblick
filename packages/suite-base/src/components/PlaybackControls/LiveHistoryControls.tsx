// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { History20Regular } from "@fluentui/react-icons";
import { compare } from "@foxglove/rostime";
import CheckIcon from "@mui/icons-material/Check";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import { Button, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import { useState } from "react";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";

import HoverableIconButton from "@lichtblick/suite-base/components/HoverableIconButton";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { liveHistorySettings } from "@lichtblick/suite-base/players/liveHistory/liveHistorySettings";
import { Player } from "@lichtblick/suite-base/players/types";

const useStyles = makeStyles()((theme) => ({
  liveButton: {
    minWidth: 0,
    paddingTop: 0,
    paddingBottom: 0,
    "&.Mui-disabled": { color: theme.palette.error.main },
  },
}));

const WINDOW_OPTIONS_SEC = [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600];

export const formatWindow = (sec: number): string =>
  sec < 60 ? `${sec} s` : sec < 3600 ? `${sec / 60} min` : `${sec / 3600} h`;

/** Live = playing at the newest received data. */
const selectIsLive = ({ playerState }: MessagePipelineContext) => {
  const data = playerState.activeData;
  return data != undefined && data.isPlaying && compare(data.currentTime, data.endTime) >= 0;
};

/**
 * Live button and history length for live sources with a rolling history: shows whether panels
 * show the newest data, and jumps back to it.
 */
export function LiveHistoryControls({
  play,
  seek,
}: Readonly<{
  play: NonNullable<Player["startPlayback"]>;
  seek: NonNullable<Player["seekPlayback"]>;
}>): React.JSX.Element {
  const { classes } = useStyles();
  const isLive = useMessagePipeline(selectIsLive);
  const getPipeline = useMessagePipelineGetter();
  const windowSec = useStore(liveHistorySettings, (state) => state.windowSec);
  const setWindowSec = useStore(liveHistorySettings, (state) => state.setWindowSec);
  const [anchorEl, setAnchorEl] = useState<HTMLElement>();

  const goLive = () => {
    const endTime = getPipeline().playerState.activeData?.endTime;
    if (endTime) {
      seek(endTime);
    }
    play();
  };

  return (
    <>
      <Button
        size="small"
        variant={isLive ? "text" : "outlined"}
        color={isLive ? "error" : "inherit"}
        startIcon={<FiberManualRecordIcon fontSize="small" />}
        onClick={goLive}
        disabled={isLive}
        title={isLive ? "Showing live data" : "Jump to the newest data and follow it"}
        data-testid="live-button"
        className={classes.liveButton}
      >
        Live
      </Button>
      <HoverableIconButton
        size="small"
        title={`History kept while connected: ${formatWindow(windowSec)}`}
        icon={<History20Regular />}
        onClick={(event) => {
          setAnchorEl(event.currentTarget);
        }}
        data-testid="live-history-window"
      />
      <Menu
        anchorEl={anchorEl}
        open={anchorEl != undefined}
        onClose={() => {
          setAnchorEl(undefined);
        }}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <MenuItem disabled dense>
          <ListItemText inset>Keep history for</ListItemText>
        </MenuItem>
        {WINDOW_OPTIONS_SEC.map((sec) => (
          <MenuItem
            key={sec}
            dense
            selected={sec === windowSec}
            onClick={() => {
              setWindowSec(sec);
              setAnchorEl(undefined);
            }}
          >
            {sec === windowSec && (
              <ListItemIcon>
                <CheckIcon fontSize="small" />
              </ListItemIcon>
            )}
            <ListItemText inset={sec !== windowSec}>{formatWindow(sec)}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
