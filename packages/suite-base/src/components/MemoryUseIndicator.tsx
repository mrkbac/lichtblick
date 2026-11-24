// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Tooltip, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { makeStyles } from "tss-react/mui";

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
  fps: number;
  /** Longest gap between two frames in the last sample, i.e. the worst stutter the user saw. */
  maxFrameMs: number;
  /** Chrome-only `performance.memory`. */
  heap?: HeapInfo;
};

const SAMPLE_MS = 1000;

function useDebugStats(): DebugStats | undefined {
  const [stats, setStats] = useState<DebugStats>();

  useEffect(() => {
    let frames = 0;
    let maxFrameMs = 0;
    let lastFrame = performance.now();
    let lastSample = lastFrame;

    let rafId = requestAnimationFrame(function onFrame(now) {
      frames++;
      maxFrameMs = Math.max(maxFrameMs, now - lastFrame);
      lastFrame = now;
      rafId = requestAnimationFrame(onFrame);
    });

    const interval = setInterval(() => {
      const now = performance.now();
      // Hidden tabs pause frames; a sample then would read as a false stall.
      if (!document.hidden) {
        setStats({
          fps: (frames * 1000) / (now - lastSample),
          // Include the frame still pending, or a full stall would read as 0 ms.
          maxFrameMs: Math.max(maxFrameMs, now - lastFrame),
          heap: (performance as { memory?: HeapInfo }).memory,
        });
      }
      frames = maxFrameMs = 0;
      lastSample = now;
    }, SAMPLE_MS);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(interval);
    };
  }, []);

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
        level={stats.fps < 20 ? "bad" : stats.fps < 45 ? "warn" : undefined}
        tooltip="Frames rendered in the last second"
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
