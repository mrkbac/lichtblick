// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec } from "@foxglove/rostime";
import CloseIcon from "@mui/icons-material/Close";
import { Button, IconButton, Tooltip, Typography } from "@mui/material";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { useLatest } from "@lichtblick/hooks";
import {
  shiftRange,
  useTrimStore,
} from "@lichtblick/suite-base/components/ExportRecordingDialog/trimStore";
import {
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  selectCurrentTime,
  selectEndTime,
  selectHasCurrentTime,
  selectStartTime,
} from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import Stack from "@lichtblick/suite-base/components/Stack";

const HANDLE_WIDTH = 8;
/** Half height of the strip around the track that keeps scrubbing; the band above and below it moves the cut. */
const SCRUB_HALF_HEIGHT = 5;
/** Matches the handles' 4px inset from the scrubber's top and bottom. */
const GRAB_INSET = 4;
/** Pointer travel before a press on the band counts as a drag instead of a click-to-seek. */
const DRAG_THRESHOLD_PX = 3;

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
    "&:focus-visible": {
      outline: `2px solid ${theme.palette.primary.dark}`,
      outlineOffset: 2,
    },
  },
  grab: {
    "&, & *": { cursor: "grab !important" },
  },
  grabbing: {
    "&, & *": { cursor: "grabbing !important" },
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

const NO_KEY_HANDLERS = {};

/** Reads the playhead on demand, so callers don't re-render on every playback tick. */
function usePlayheadGetter(): () => bigint | undefined {
  const getPipeline = useMessagePipelineGetter();
  return useMemo(
    () => () => {
      const currentTime = selectCurrentTime(getPipeline());
      return currentTime ? toNanoSec(currentTime) : undefined;
    },
    [getPipeline],
  );
}

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

type OverlayProps = {
  /** The scrubber's slider. Pressing the band above or below its track moves the whole cut. */
  sliderRef: React.RefObject<HTMLDivElement | null>;
  /** Seek to a fraction of the recording, for a press on the band that doesn't drag. */
  onSeek: (fraction: number) => void;
};

/**
 * Highlighted trim range with draggable in and out handles, drawn over the scrubber. While
 * editing, dragging the band above or below the track moves both ends at a fixed length.
 */
export function TrimRangeOverlay({ sliderRef, onSeek }: OverlayProps): React.JSX.Element | null {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("exportRecording");
  const editing = useTrimStore((state) => state.editing);
  const setRange = useTrimStore((state) => state.setRange);
  const bounds = useRecordingBounds();
  const start = useTrimStore((state) => state.start);
  const end = useTrimStore((state) => state.end);
  const rootRef = useRef<HTMLDivElement>(null);
  const latestBounds = useLatest(bounds);
  const latestOnSeek = useLatest(onSeek);

  // Native listeners on the slider: a capture-phase pointerdown on the band beats the slider's own
  // seek-and-scrub, while hover keeps flowing to the slider (hover time, tooltip). Cursor and drag
  // state live outside React, so hovering costs no renders.
  useEffect(() => {
    const slider = sliderRef.current;
    if (!editing || !slider) {
      return undefined;
    }
    const fractionAt = (clientX: number) => {
      const rect = slider.getBoundingClientRect();
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    };
    const timeAtX = (clientX: number, b: { start: bigint; end: bigint }) =>
      b.start + BigInt(Math.round(fractionAt(clientX) * Number(b.end - b.start)));
    const onBand = (ev: PointerEvent): boolean => {
      const b = latestBounds.current;
      const cut = useTrimStore.getState();
      if (!b || cut.start == undefined || cut.end == undefined) {
        return false;
      }
      const rect = slider.getBoundingClientRect();
      const dy = Math.abs(ev.clientY - (rect.top + rect.height / 2));
      if (dy < SCRUB_HALF_HEIGHT || dy > rect.height / 2 - GRAB_INSET) {
        return false;
      }
      const time = timeAtX(ev.clientX, b);
      return time > cut.start && time < cut.end;
    };

    let dragging = false;
    const onHover = (ev: PointerEvent) => {
      if (!dragging) {
        slider.classList.toggle(classes.grab, onBand(ev));
      }
    };
    const onLeave = () => {
      slider.classList.remove(classes.grab);
    };
    const onDown = (ev: PointerEvent) => {
      const b = latestBounds.current;
      const cut = useTrimStore.getState();
      const { start: cutStart, end: cutEnd } = cut;
      if (ev.button !== 0 || !b || cutStart == undefined || cutEnd == undefined || !onBand(ev)) {
        return;
      }
      ev.stopPropagation();
      ev.preventDefault();
      dragging = true;
      slider.classList.add(classes.grabbing);
      const x0 = ev.clientX;
      const anchor = timeAtX(x0, b);
      let moved = false;
      const onMove = (move: PointerEvent) => {
        if (!moved && Math.abs(move.clientX - x0) < DRAG_THRESHOLD_PX) {
          return;
        }
        moved = true;
        cut.setRange(
          ...shiftRange(cutStart, cutEnd, timeAtX(move.clientX, b) - anchor, b.start, b.end),
        );
      };
      const onUp = (up: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        dragging = false;
        slider.classList.remove(classes.grabbing);
        if (!moved && up.type === "pointerup") {
          latestOnSeek.current(fractionAt(up.clientX));
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };
    slider.addEventListener("pointerdown", onDown, { capture: true });
    slider.addEventListener("pointermove", onHover);
    slider.addEventListener("pointerleave", onLeave);
    return () => {
      slider.removeEventListener("pointerdown", onDown, { capture: true });
      slider.removeEventListener("pointermove", onHover);
      slider.removeEventListener("pointerleave", onLeave);
      slider.classList.remove(classes.grab, classes.grabbing);
    };
  }, [editing, sliderRef, latestBounds, latestOnSeek, classes.grab, classes.grabbing]);

  if (!bounds || start == undefined || end == undefined) {
    return null;
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
        {...(editing && {
          role: "slider",
          tabIndex: 0,
          "aria-label": t("trimMove"),
          "aria-valuemin": 0,
          "aria-valuemax": Number(formatSeconds(bounds.end - bounds.start - (end - start))),
          "aria-valuenow": Number(formatSeconds(start - bounds.start)),
          "aria-valuetext": `${formatSeconds(start - bounds.start)} s – ${formatSeconds(end - bounds.start)} s`,
          onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
            const delta =
              event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0n;
            if (delta === 0n) {
              return;
            }
            event.stopPropagation();
            event.preventDefault();
            // Read the store, not render-time values, so fast key repeats accumulate.
            const cut = useTrimStore.getState();
            if (cut.start != undefined && cut.end != undefined) {
              setRange(...shiftRange(cut.start, cut.end, delta, bounds.start, bounds.end));
            }
          },
        })}
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
export function TrimBar(): React.JSX.Element | null {
  const { classes } = useStyles();
  const { t } = useTranslation("exportRecording");
  const editing = useTrimStore((state) => state.editing);
  const setRange = useTrimStore((state) => state.setRange);
  const clear = useTrimStore((state) => state.clear);
  const openExport = useTrimStore((state) => state.openExport);
  const hasPlayhead = useMessagePipeline(selectHasCurrentTime);
  const getPlayhead = usePlayheadGetter();
  const { bounds, start, end } = useTrimRange();

  if (!editing || !bounds || start == undefined || end == undefined) {
    return null;
  }

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
            disabled={!hasPlayhead}
            onClick={() => {
              const playhead = getPlayhead();
              if (playhead != undefined) {
                setRange(playhead, playhead > end ? playhead : end);
              }
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
            disabled={!hasPlayhead}
            onClick={() => {
              const playhead = getPlayhead();
              if (playhead != undefined) {
                setRange(playhead < start ? playhead : start, playhead);
              }
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
        <CloseIcon style={{ fontSize: 16 }} />
      </IconButton>
    </Stack>
  );
}

/** Keyboard handlers for setting in and out points at the playhead while trimming. */
export function useTrimKeyHandlers(): {
  "playback.trimIn"?: () => boolean;
  "playback.trimOut"?: () => boolean;
} {
  const editing = useTrimStore((state) => state.editing);
  const getPlayhead = usePlayheadGetter();
  const getPipeline = useMessagePipelineGetter();
  return useMemo(() => {
    if (!editing) {
      return NO_KEY_HANDLERS;
    }
    // Resolve everything at key press; return false (keep the default) when there is nothing to set.
    const resolve = () => {
      const { start, end, setRange } = useTrimStore.getState();
      const activeData = getPipeline().playerState.activeData;
      const playhead = getPlayhead();
      const s = start ?? (activeData?.startTime ? toNanoSec(activeData.startTime) : undefined);
      const e = end ?? (activeData?.endTime ? toNanoSec(activeData.endTime) : undefined);
      return playhead == undefined || s == undefined || e == undefined
        ? undefined
        : { playhead, start: s, end: e, setRange };
    };
    return {
      "playback.trimIn": () => {
        const r = resolve();
        if (!r) {
          return false;
        }
        r.setRange(r.playhead, r.playhead > r.end ? r.playhead : r.end);
        return true;
      },
      "playback.trimOut": () => {
        const r = resolve();
        if (!r) {
          return false;
        }
        r.setRange(r.playhead < r.start ? r.playhead : r.start, r.playhead);
        return true;
      },
    };
  }, [editing, getPipeline, getPlayhead]);
}
