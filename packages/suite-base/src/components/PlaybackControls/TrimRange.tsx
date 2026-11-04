// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Dismiss16Regular } from "@fluentui/react-icons";
import { toNanoSec } from "@foxglove/rostime";
import { Button, IconButton, Tooltip, Typography } from "@mui/material";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { useTrimStore } from "@lichtblick/suite-base/components/ExportRecordingDialog/trimStore";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Stack from "@lichtblick/suite-base/components/Stack";

const HANDLE_WIDTH = 8;

const useStyles = makeStyles()((theme) => ({
  overlay: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
  },
  dim: {
    position: "absolute",
    top: 0,
    bottom: 0,
    backgroundColor: theme.palette.background.paper,
    opacity: 0.7,
    pointerEvents: "none",
  },
  band: {
    position: "absolute",
    top: 8,
    bottom: 8,
    borderTop: `2px solid ${theme.palette.primary.main}`,
    borderBottom: `2px solid ${theme.palette.primary.main}`,
    pointerEvents: "none",
  },
  handle: {
    position: "absolute",
    top: 4,
    bottom: 4,
    width: HANDLE_WIDTH,
    backgroundColor: theme.palette.primary.main,
    cursor: "ew-resize",
    pointerEvents: "auto",
    touchAction: "none",
    zIndex: 1,
    "&:hover, &:focus-visible": {
      backgroundColor: theme.palette.primary.dark,
      outline: "none",
    },
  },
  // Both handles sit inside the range, so they stay visible at the timeline's edges.
  handleStart: {
    borderRadius: "4px 0 0 4px",
  },
  handleEnd: {
    borderRadius: "0 4px 4px 0",
    transform: "translateX(-100%)",
  },
  bar: {
    padding: theme.spacing(0.25, 0),
  },
}));

const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;

function useRecordingBounds(): { start: bigint; end: bigint } | undefined {
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  return startTime && endTime
    ? { start: toNanoSec(startTime), end: toNanoSec(endTime) }
    : undefined;
}

/** The trim range on the timeline, or the whole recording if none is set yet. */
function useTrimRange() {
  const bounds = useRecordingBounds();
  const start = useTrimStore((state) => state.start) ?? bounds?.start;
  const end = useTrimStore((state) => state.end) ?? bounds?.end;
  return { bounds, start, end };
}

export function formatSeconds(ns: bigint): string {
  return (Number(ns) / 1e9).toFixed(3);
}

/** Highlighted trim range with draggable in and out handles, drawn over the scrubber. */
export function TrimRangeOverlay(): React.JSX.Element | ReactNull {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("exportRecording");
  const editing = useTrimStore((state) => state.editing);
  const setRange = useTrimStore((state) => state.setRange);
  const bounds = useRecordingBounds();
  const start = useTrimStore((state) => state.start);
  const end = useTrimStore((state) => state.end);
  const rootRef = useRef<HTMLDivElement>(ReactNull);

  if (!bounds || start == undefined || end == undefined) {
    return ReactNull;
  }
  const duration = Math.max(1, Number(bounds.end - bounds.start));
  const toPercent = (ns: bigint) => (Number(ns - bounds.start) / duration) * 100;
  const startPercent = toPercent(start);
  const endPercent = toPercent(end);

  const timeAt = (clientX: number): bigint => {
    const rect = rootRef.current!.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return bounds.start + BigInt(Math.round(fraction * duration));
  };
  const step = BigInt(Math.round(duration / 100));

  const handleProps = (which: "start" | "end") => ({
    role: "slider",
    tabIndex: 0,
    "aria-label": which === "start" ? t("trimStart") : t("trimEnd"),
    "aria-valuemin": 0,
    "aria-valuemax": Number(formatSeconds(bounds.end - bounds.start)),
    "aria-valuenow": Number(formatSeconds((which === "start" ? start : end) - bounds.start)),
    "aria-valuetext": `${formatSeconds((which === "start" ? start : end) - bounds.start)} s`,
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      // Don't let the scrubber below seek.
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        return;
      }
      const time = timeAt(event.clientX);
      if (which === "start") {
        setRange(time < end ? time : end, end);
      } else {
        setRange(start, time > start ? time : start);
      }
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      const delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0n;
      if (delta === 0n) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      const clamp = (ns: bigint, lo: bigint, hi: bigint) => (ns < lo ? lo : ns > hi ? hi : ns);
      if (which === "start") {
        setRange(clamp(start + delta, bounds.start, end), end);
      } else {
        setRange(start, clamp(end + delta, start, bounds.end));
      }
    },
  });

  return (
    <div ref={rootRef} className={classes.overlay}>
      <div className={classes.dim} style={{ left: 0, width: `${startPercent}%` }} />
      <div className={classes.dim} style={{ left: `${endPercent}%`, right: 0 }} />
      <div
        className={classes.band}
        style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}
      />
      {editing && (
        <>
          <div
            className={cx(classes.handle, classes.handleStart)}
            style={{ left: `${startPercent}%` }}
            {...handleProps("start")}
          />
          <div
            className={cx(classes.handle, classes.handleEnd)}
            style={{ left: `${endPercent}%` }}
            {...handleProps("end")}
          />
        </>
      )}
    </div>
  );
}

/** Row under the scrubber while trimming: range readout, set in/out, export, close. */
export function TrimBar(): React.JSX.Element | ReactNull {
  const { classes } = useStyles();
  const { t } = useTranslation("exportRecording");
  const editing = useTrimStore((state) => state.editing);
  const setRange = useTrimStore((state) => state.setRange);
  const clear = useTrimStore((state) => state.clear);
  const openExport = useTrimStore((state) => state.openExport);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const { bounds, start, end } = useTrimRange();

  if (!editing || !bounds || start == undefined || end == undefined) {
    return ReactNull;
  }
  const playhead = currentTime ? toNanoSec(currentTime) : undefined;

  return (
    <Stack direction="row" alignItems="center" gap={1} className={classes.bar}>
      <Typography variant="body2" noWrap>
        {t("trimRange", {
          start: formatSeconds(start - bounds.start),
          end: formatSeconds(end - bounds.start),
          duration: formatSeconds(end - start),
        })}
      </Typography>
      <Tooltip title={t("setInShortcut")}>
        <span>
          <Button
            size="small"
            disabled={playhead == undefined}
            onClick={() => {
              setRange(playhead!, playhead! > end ? playhead! : end);
            }}
          >
            {t("setIn")}
          </Button>
        </span>
      </Tooltip>
      <Tooltip title={t("setOutShortcut")}>
        <span>
          <Button
            size="small"
            disabled={playhead == undefined}
            onClick={() => {
              setRange(playhead! < start ? playhead! : start, playhead!);
            }}
          >
            {t("setOut")}
          </Button>
        </span>
      </Tooltip>
      <Stack flex={1} />
      <Button
        size="small"
        variant="contained"
        onClick={() => {
          openExport();
        }}
      >
        {t("exportEllipsis")}
      </Button>
      <IconButton size="small" aria-label={t("removeCut")} title={t("removeCut")} onClick={clear}>
        <Dismiss16Regular />
      </IconButton>
    </Stack>
  );
}

/** Keyboard handlers for setting in and out points at the playhead while trimming. */
export function useTrimKeyHandlers(): Record<string, () => void> {
  const editing = useTrimStore((state) => state.editing);
  const setRange = useTrimStore((state) => state.setRange);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const { start, end } = useTrimRange();
  if (!editing || !currentTime || start == undefined || end == undefined) {
    return {};
  }
  const playhead = toNanoSec(currentTime);
  return {
    i: () => {
      setRange(playhead, playhead > end ? playhead : end);
    },
    o: () => {
      setRange(playhead < start ? playhead : start, playhead);
    },
  };
}
