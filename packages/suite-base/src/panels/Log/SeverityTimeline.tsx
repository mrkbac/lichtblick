// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromSec, add as addTimes, subtract as subtractTimes, toSec } from "@foxglove/rostime";
import { useTheme } from "@mui/material";
import { useCallback } from "react";
import { makeStyles } from "tss-react/mui";

import { Time } from "@lichtblick/suite";
import AutoSizingCanvas from "@lichtblick/suite-base/components/AutoSizingCanvas";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";

import { LogLevel, NormalizedLogMessage } from "./types";

const HEIGHT = 8;

const useStyles = makeStyles()((theme) => ({
  root: {
    position: "relative",
    height: HEIGHT,
    flex: "none",
    backgroundColor: theme.palette.action.hover,
  },
  seekable: {
    cursor: "pointer",
  },
  playhead: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: theme.palette.text.primary,
    pointerEvents: "none",
  },
}));

const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
/**
 * Duration rounded up to a power-of-two step of at most 1/1024 of it, so a live source's growing
 * end time redraws only when columns could actually shift (by under one at 1024 px), not every tick.
 * Exported for tests.
 */
export function roundUpDuration(durationSec: number): number {
  if (durationSec <= 0) {
    return 0;
  }
  const step = 2 ** Math.floor(Math.log2(durationSec / 1024));
  return Math.ceil(durationSec / step) * step;
}

const selectDurationSec = (ctx: MessagePipelineContext) => {
  const { startTime, endTime } = ctx.playerState.activeData ?? {};
  return roundUpDuration(startTime && endTime ? toSec(subtractTimes(endTime, startTime)) : 0);
};
const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const exactDurationSec = (start: Time, end: Time | undefined) =>
  end ? toSec(subtractTimes(end, start)) : 0;

/**
 * Highest log level per horizontal pixel column, for items in [start, start + duration].
 * Exported for tests.
 */
export function binLevels(
  items: readonly NormalizedLogMessage[],
  start: Time,
  durationSec: number,
  columns: number,
): Uint8Array {
  const bins = new Uint8Array(Math.max(0, Math.floor(columns)));
  if (bins.length === 0 || durationSec <= 0) {
    return bins;
  }
  const startSec = toSec(start);
  for (const item of items) {
    const fraction = (toSec(item.receiveTime) - startSec) / durationSec;
    // A message exactly at the end belongs to the last column
    const col = Math.min(Math.floor(fraction * bins.length), bins.length - 1);
    if (fraction >= 0 && fraction <= 1) {
      // +1 so that UNKNOWN (0) messages still mark their column
      bins[col] = Math.max(bins[col]!, item.level + 1);
    }
  }
  return bins;
}

function Playhead({ start }: { start: Time }) {
  const { classes } = useStyles();
  const currentTime = useMessagePipeline(selectCurrentTime);
  // Re-renders every tick anyway, so position it with the exact duration
  const durationSec = exactDurationSec(start, useMessagePipeline(selectEndTime));
  if (currentTime == undefined) {
    return null;
  }
  const fraction = (toSec(currentTime) - toSec(start)) / durationSec;
  if (!(fraction >= 0 && fraction <= 1)) {
    return null;
  }
  return <div className={classes.playhead} style={{ left: `${fraction * 100}%` }} />;
}

/** Thin strip showing where (filtered) log messages occur over the whole range, by severity. */
export function SeverityTimeline({
  items,
  onSeek,
}: {
  items: readonly NormalizedLogMessage[];
  onSeek?: (time: Time) => void;
}): React.JSX.Element | null {
  const { classes, cx } = useStyles();
  const { palette } = useTheme();
  const start = useMessagePipeline(selectStartTime);
  // Rounded so live sources redraw only when columns move; seeking and the playhead use the exact end
  const durationSec = useMessagePipeline(selectDurationSec);
  const getPipeline = useMessagePipelineGetter();

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      ctx.clearRect(0, 0, width, height);
      if (!start) {
        return;
      }
      const bins = binLevels(items, start, durationSec, width);
      bins.forEach((bin, x) => {
        if (bin === 0) {
          return;
        }
        const level = bin - 1;
        if (level >= LogLevel.ERROR) {
          ctx.fillStyle = palette.error.main;
          ctx.fillRect(x, 0, 1, height);
        } else if (level === LogLevel.WARN) {
          ctx.fillStyle = palette.warning.main;
          ctx.fillRect(x, 0, 1, height);
        } else {
          ctx.fillStyle = palette.text.disabled;
          ctx.fillRect(x, height / 2, 1, height / 2);
        }
      });
    },
    [items, start, durationSec, palette],
  );

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onSeek || !start) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const exactSec = exactDurationSec(start, selectEndTime(getPipeline()));
      onSeek(addTimes(start, fromSec(fraction * exactSec)));
    },
    [onSeek, start, getPipeline],
  );

  if (!start || durationSec <= 0) {
    return null;
  }

  return (
    <div
      className={cx(classes.root, { [classes.seekable]: onSeek != undefined })}
      onClick={onClick}
      data-testid="log-severity-timeline"
    >
      <AutoSizingCanvas draw={draw} />
      <Playhead start={start} />
    </div>
  );
}
