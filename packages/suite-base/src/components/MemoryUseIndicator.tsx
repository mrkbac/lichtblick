// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Tooltip, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { makeStyles } from "tss-react/mui";

import {
  type MessagePipelineContext,
  useMessagePipelineSubscribe,
} from "@lichtblick/suite-base/components/MessagePipeline";

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    fontVariantNumeric: "tabular-nums",
  },
  stat: {
    display: "flex",
    alignItems: "center",
    flexDirection: "column",
    minWidth: 40,
  },
  label: {
    fontWeight: "bold",
    lineHeight: 1.1,
  },
  text: {
    lineHeight: 1.1,
  },
  warn: { color: theme.palette.warning.main },
  bad: { color: theme.palette.error.main },
}));

type HeapInfo = { usedJSHeapSize: number; jsHeapSizeLimit: number };

type DebugStats = {
  /** Frames the browser produced; on an idle page this is the display refresh rate. */
  fps: number;
  /** Highest FPS seen so far: the display refresh rate, the target the FPS readout is judged by. */
  refreshFps: number;
  /** Frames that showed new player data: a redraw of the panels, at most one per frame. */
  draws: number;
  /** Longest gap between two frames in the last sample, i.e. the worst stutter the user saw. */
  maxFrameMs: number;
  /** Chrome-only `performance.memory`. */
  heap?: HeapInfo;
};

const SAMPLE_MS = 1000;

function useDebugStats(): DebugStats | undefined {
  const [stats, setStats] = useState<DebugStats>();
  const subscribe = useMessagePipelineSubscribe();

  useEffect(() => {
    let frames = 0;
    let draws = 0;
    let refreshFps = 0;
    // Panels render a new player state in the next frame; several states before one frame show as
    // one redraw, and store changes that aren't a new player state don't redraw anything
    let pendingDraw = false;
    let lastPlayerState: MessagePipelineContext["playerState"] | undefined;
    const unsubscribe = subscribe((state) => {
      if (state.playerState !== lastPlayerState) {
        lastPlayerState = state.playerState;
        pendingDraw = true;
      }
    });
    let maxFrameMs = 0;
    let lastFrame = performance.now();
    let lastSample = lastFrame;

    let rafId = requestAnimationFrame(function onFrame(now) {
      frames++;
      if (pendingDraw) {
        pendingDraw = false;
        draws++;
      }
      maxFrameMs = Math.max(maxFrameMs, now - lastFrame);
      lastFrame = now;
      rafId = requestAnimationFrame(onFrame);
    });

    const interval = setInterval(() => {
      const now = performance.now();
      // Hidden tabs pause frames; a sample then would read as a false stall.
      if (!document.hidden) {
        const fps = (frames * 1000) / (now - lastSample);
        refreshFps = Math.max(refreshFps, fps);
        setStats({
          fps,
          refreshFps,
          draws: (draws * 1000) / (now - lastSample),
          // Include the frame still pending, or a full stall would read as 0 ms.
          maxFrameMs: Math.max(maxFrameMs, now - lastFrame),
          heap: (performance as { memory?: HeapInfo }).memory,
        });
      }
      frames = draws = maxFrameMs = 0;
      lastSample = now;
    }, SAMPLE_MS);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(interval);
      unsubscribe();
    };
  }, [subscribe]);

  return stats;
}

function toMB(bytes: number): string {
  return Math.round(bytes / 1024 / 1024).toLocaleString();
}

function Stat(props: {
  label: string;
  value: string;
  level?: "warn" | "bad";
  tooltip: string;
}): React.JSX.Element {
  const { classes, cx } = useStyles();
  return (
    <Tooltip arrow={false} title={props.tooltip} placement="bottom">
      <div className={classes.stat}>
        <Typography className={classes.label} variant="caption">
          {props.label}
        </Typography>
        <Typography
          className={cx(classes.text, {
            [classes.warn]: props.level === "warn",
            [classes.bad]: props.level === "bad",
          })}
          variant="caption"
        >
          {props.value}
        </Typography>
      </div>
    </Tooltip>
  );
}

function level(value: number, warnAt: number, badAt: number): "warn" | "bad" | undefined {
  return value >= badAt ? "bad" : value >= warnAt ? "warn" : undefined;
}

/** App bar debug readout: frame rate, worst frame and JS heap, colored when they look unhealthy. */
function MemoryUseIndicator(): React.JSX.Element {
  const stats = useDebugStats();
  const { classes } = useStyles();

  if (!stats) {
    return <></>;
  }

  const heapPercent = stats.heap
    ? (stats.heap.usedJSHeapSize / stats.heap.jsHeapSizeLimit) * 100
    : undefined;

  return (
    <div className={classes.root}>
      <Stat
        label="FPS"
        value={stats.fps.toFixed(0)}
        level={
          stats.fps < stats.refreshFps / 3
            ? "bad"
            : stats.fps < stats.refreshFps * 0.75
              ? "warn"
              : undefined
        }
        tooltip={`Browser frames in the last second (display refreshes at ~${stats.refreshFps.toFixed(0)}). Below that, frames are being dropped.`}
      />
      <Stat
        label="DRAW"
        value={stats.draws.toFixed(0)}
        tooltip="Frames in the last second that showed new player data (0 while paused)"
      />
      <Stat
        label="MAX"
        value={`${stats.maxFrameMs.toFixed(0)}ms`}
        level={level(stats.maxFrameMs, 50, 200)}
        tooltip="Longest frame in the last second (stutter / main-thread block)"
      />
      {stats.heap && heapPercent != undefined && (
        <Stat
          label="MEM"
          value={`${heapPercent.toFixed(1)}%`}
          level={level(heapPercent, 60, 85)}
          tooltip={`JS heap used (MB): ${toMB(stats.heap.usedJSHeapSize)} / ${toMB(stats.heap.jsHeapSizeLimit)}`}
        />
      )}
    </div>
  );
}

export { MemoryUseIndicator };
