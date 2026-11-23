// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  subtract as subtractTimes,
  add as addTimes,
  toSec,
  fromSec,
  Time,
} from "@foxglove/rostime";
import { Fade, PopperProps, Tooltip } from "@mui/material";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { useLatest } from "@lichtblick/hooks";
import { CompareTimelineOverlay } from "@lichtblick/suite-base/components/Compare/CompareTimelineOverlay";
import { clampTimeToCut } from "@lichtblick/suite-base/components/ExportRecordingDialog/trimStore";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  selectCurrentTime,
  selectEndTime,
  selectPlayerPresence,
  selectStartTime,
} from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  useClearHoverValue,
  useSetHoverValue,
} from "@lichtblick/suite-base/context/TimelineInteractionStateContext";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";
import BroadcastManager from "@lichtblick/suite-base/util/broadcast/BroadcastManager";
import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";

import { EventsOverlay } from "./EventsOverlay";
import { PanelTimeRangeOverlay } from "./PanelTimeRangeOverlay";
import PlaybackBarHoverTicks from "./PlaybackBarHoverTicks";
import { PlaybackControlsTooltipContent } from "./PlaybackControlsTooltipContent";
import { ProgressPlot } from "./ProgressPlot";
import Slider, { HoverOverEvent } from "./Slider";
import { TrimRangeOverlay } from "./TrimRange";
import { useScrubPreview } from "./useScrubPreview";

type PopperInstance = PopperProps["popperRef"] extends React.Ref<infer T> | undefined ? T : never;

const useStyles = makeStyles()((theme) => ({
  marker: {
    backgroundColor: theme.palette.text.primary,
    position: "absolute",
    height: 16,
    borderRadius: 1,
    width: 2,
    transform: "translate(-50%, 0)",
    // Above the cut handles, so the playhead stays visible at the cut's edges.
    zIndex: 2,
  },
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 6,
    backgroundColor: theme.palette.action.focus,
  },
  trackDisabled: {
    opacity: theme.palette.action.disabledOpacity,
  },
}));

const selectRanges = (ctx: MessagePipelineContext) =>
  ctx.playerState.progress.fullyLoadedFractionRanges;

type Props = {
  onSeek: (seekTo: Time) => void;
};

export default function Scrubber(props: Props): React.JSX.Element {
  const { onSeek } = props;
  const { classes, cx } = useStyles();

  const [hoverComponentId] = useState<string>(() => randomUUID());

  const startTime = useMessagePipeline(selectStartTime);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const endTime = useMessagePipeline(selectEndTime);
  const presence = useMessagePipeline(selectPlayerPresence);
  const ranges = useMessagePipeline(selectRanges);

  const setHoverValue = useSetHoverValue();

  type HoverInfo = {
    stamp: Time;
    clientX: number;
    clientY: number;
  };
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | undefined>();
  const latestHoverInfo = useLatest(hoverInfo);
  const thumbnail = useScrubPreview(hoverInfo?.stamp);

  const latestStartTime = useLatest(startTime);
  const latestEndTime = useLatest(endTime);

  const onChange = useCallback(
    (fraction: number) => {
      if (!latestStartTime.current || !latestEndTime.current) {
        return;
      }
      const timeToSeek = clampTimeToCut(
        addTimes(
          latestStartTime.current,
          fromSec(fraction * toSec(subtractTimes(latestEndTime.current, latestStartTime.current))),
        ),
      );
      onSeek(timeToSeek);
      BroadcastManager.getInstance().postMessage({
        type: "seek",
        time: timeToSeek,
      });
    },
    [onSeek, latestEndTime, latestStartTime],
  );

  const onHoverOver = useCallback(
    ({ fraction, clientX, clientY }: HoverOverEvent) => {
      if (!latestStartTime.current || !latestEndTime.current) {
        return;
      }
      const duration = toSec(subtractTimes(latestEndTime.current, latestStartTime.current));
      const timeFromStart = fromSec(fraction * duration);
      setHoverInfo({ stamp: addTimes(latestStartTime.current, timeFromStart), clientX, clientY });
      setHoverValue({
        componentId: hoverComponentId,
        type: "PLAYBACK_SECONDS",
        value: toSec(timeFromStart),
      });
    },
    [hoverComponentId, latestEndTime, latestStartTime, setHoverValue],
  );

  const clearHoverValue = useClearHoverValue();

  const onHoverOut = useCallback(() => {
    clearHoverValue(hoverComponentId);
    setHoverInfo(undefined);
  }, [clearHoverValue, hoverComponentId]);

  // Clean up the hover value when we are unmounted -- important for storybook.
  useEffect(() => onHoverOut, [onHoverOut]);

  const renderSlider = useCallback(
    (val?: number) => {
      if (val == undefined) {
        return undefined;
      }
      return <div className={classes.marker} style={{ left: `${val * 100}%` }} />;
    },
    [classes.marker],
  );

  const min = startTime && toSec(startTime);
  const max = endTime && toSec(endTime);
  const duration = startTime && endTime ? toSec(subtractTimes(endTime, startTime)) : 0;
  const fraction =
    currentTime && startTime && duration > 0
      ? toSec(subtractTimes(currentTime, startTime)) / duration
      : undefined;

  const loading = presence === PlayerPresence.INITIALIZING || presence === PlayerPresence.BUFFERING;

  const popperRef = React.useRef<PopperInstance>(null);

  const isHovered = hoverInfo != undefined;
  const popperProps: Partial<PopperProps> = useMemo(
    () => ({
      open: isHovered, // Keep the tooltip visible while dragging even when the mouse is outside the playback bar
      popperRef,
      modifiers: [
        {
          name: "computeStyles",
          options: {
            gpuAcceleration: false, // Fixes hairline seam on arrow in chrome.
          },
        },
        {
          name: "offset",
          options: {
            // Offset popper to hug the track better.
            offset: [0, 4],
          },
        },
      ],
      anchorEl: {
        getBoundingClientRect: () => {
          return new DOMRect(
            latestHoverInfo.current?.clientX ?? 0,
            latestHoverInfo.current?.clientY ?? 0,
            0,
            0,
          );
        },
      },
    }),
    [isHovered, latestHoverInfo],
  );

  useEffect(() => {
    if (popperRef.current != undefined) {
      void popperRef.current.update();
    }
  }, [hoverInfo, thumbnail]);

  return (
    <Tooltip
      title={
        hoverInfo != undefined ? (
          <PlaybackControlsTooltipContent stamp={hoverInfo.stamp} thumbnail={thumbnail} />
        ) : (
          ""
        )
      }
      placement="top"
      disableInteractive
      slots={{ transition: Fade }}
      slotProps={{ transition: { timeout: 0 }, popper: popperProps }}
    >
      <Stack
        direction="row"
        flexGrow={1}
        alignItems="center"
        position="relative"
        style={{ height: 32 }}
      >
        <div className={cx(classes.track, { [classes.trackDisabled]: !startTime })} />
        <Stack position="absolute" flex="auto" fullWidth style={{ height: 6 }}>
          <ProgressPlot loading={loading} availableRanges={ranges} />
        </Stack>
        <Stack fullHeight fullWidth position="absolute" flex={1} data-testid="playback-slider">
          <Slider
            disabled={min == undefined || max == undefined}
            fraction={fraction}
            onHoverOver={onHoverOver}
            onHoverOut={onHoverOut}
            onChange={onChange}
            renderSlider={renderSlider}
          />
        </Stack>
        <PanelTimeRangeOverlay duration={duration} />
        <CompareTimelineOverlay />
        <TrimRangeOverlay />
        <EventsOverlay />
        <PlaybackBarHoverTicks componentId={hoverComponentId} />
      </Stack>
    </Tooltip>
  );
}
