// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { subtract, Time, toSec } from "@foxglove/rostime";
import { Typography } from "@mui/material";
import { makeStyles } from "tss-react/mui";

import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import {
  selectCurrentTime,
  selectEndTime,
  selectIsPlaying,
  selectStartTime,
} from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { useAppTimeFormat } from "@lichtblick/suite-base/hooks";
import { useAppConfigurationValue } from "@lichtblick/suite-base/hooks/useAppConfigurationValue";
import { useShareLink } from "@lichtblick/suite-base/hooks/useShareLink";
import { formatHms } from "@lichtblick/suite-base/util/formatTime";

import { UnconnectedPlaybackTimeDisplay } from "./UnconnectedPlaybackTimeDisplay";

const useStyles = makeStyles()((theme) => ({
  elapsed: {
    color: theme.palette.text.secondary,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    [theme.breakpoints.down("md")]: { display: "none" },
  },
}));

const elapsedText = (from: Time, to: Time) =>
  formatHms(Math.floor(toSec(subtract(to, from)) * 1000), { withMillis: false });

type Props = {
  onSeek: (seekTo: Time) => void;
  onPause: () => void;
};

export default function PlaybackTimeDisplay(props: Props): React.JSX.Element {
  const [timezone] = useAppConfigurationValue<string>(AppSetting.TIMEZONE);

  const isPlaying = useMessagePipeline(selectIsPlaying);
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const appTimeFormat = useAppTimeFormat();
  const { classes } = useStyles();
  const { availability, copyLink } = useShareLink();

  return (
    <>
      <UnconnectedPlaybackTimeDisplay
        appTimeFormat={appTimeFormat}
        currentTime={currentTime}
        startTime={startTime}
        endTime={endTime}
        onSeek={props.onSeek}
        onPause={props.onPause}
        isPlaying={isPlaying}
        timezone={timezone}
        shareLink={availability}
        copyLink={copyLink}
      />
      {startTime && endTime && currentTime && (
        <Typography variant="body2" className={classes.elapsed} data-testid="PlaybackTime-elapsed">
          {elapsedText(startTime, currentTime)} / {elapsedText(startTime, endTime)}
        </Typography>
      )}
    </>
  );
}
