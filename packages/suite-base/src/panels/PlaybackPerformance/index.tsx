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

import { subtract as subtractTimes, toSec } from "@foxglove/rostime";
import { Typography } from "@mui/material";
import React, { ReactElement, useContext, useEffect, useReducer, useRef } from "react";
import { makeStyles } from "tss-react/mui";

import { formatByteSize } from "@lichtblick/den/format";
import { Immutable } from "@lichtblick/suite";
import { PanelVisibleContext } from "@lichtblick/suite-base/components/DockPanelContext";
import {
  MessagePipelineContext,
  useMessagePipelineGetter,
  useMessagePipelineSubscribe,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Panel from "@lichtblick/suite-base/components/Panel";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import { Sparkline, SparklinePoint } from "@lichtblick/suite-base/components/Sparkline";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  PlayerStateActiveData,
  Progress,
  SubscribePayload,
} from "@lichtblick/suite-base/players/types";

const TIME_RANGE_MS = 10_000;
const TICK_MS = 250;
/** Per-topic "now" rate averages this many ticks (1 s). */
const TOPIC_NOW_TICKS = 4;
/** `measureUserAgentSpecificMemory` is slow and may run a GC; poll it rarely. */
const PAGE_MEMORY_INTERVAL_MS = 10_000;

type HeapInfo = { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
type PerformanceWithMemory = Performance & {
  memory?: HeapInfo;
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
};

type Series =
  | "renderFps"
  | "eventLoopLagMs"
  | "speed"
  | "updatesPerSec"
  | "recordingMsPerUpdate"
  | "messagesPerSec"
  | "sourceBitsPerSec";

type TopicRate = { recent: number[]; bytesThisTick: number; nowBps: number; maxBps: number };

type Stats = {
  series: Record<Series, SparklinePoint[]>;
  topics: Map<string, TopicRate>;
  subscriptions: Immutable<SubscribePayload[]>;
  progress?: Immutable<Progress>;
  activeData?: Immutable<PlayerStateActiveData>;
  heap?: HeapInfo;
  pageBytes?: number;
};

function newStats(): Stats {
  return {
    series: {
      renderFps: [],
      eventLoopLagMs: [],
      speed: [],
      updatesPerSec: [],
      recordingMsPerUpdate: [],
      messagesPerSec: [],
      sourceBitsPerSec: [],
    },
    topics: new Map(),
    subscriptions: [],
  };
}

export function formatBitRate(bitsPerSec: number): string {
  if (bitsPerSec >= 1e9) {
    return `${(bitsPerSec / 1e9).toFixed(1)} Gbps`;
  }
  if (bitsPerSec >= 1e6) {
    return `${(bitsPerSec / 1e6).toFixed(1)} Mbps`;
  }
  return `${(bitsPerSec / 1e3).toFixed(0)} kbps`;
}

/**
 * Samples the message pipeline, the browser frame loop and memory every TICK_MS and returns the
 * accumulated stats. Re-renders the caller once per tick while it is shown.
 */
function usePerformanceStats(): Stats {
  const subscribe = useMessagePipelineSubscribe();
  const getPipelineState = useMessagePipelineGetter();
  const stats = useRef<Stats>(newStats());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // Hidden (inactive tab, behind a maximized panel): keep sampling, show it when shown again
  const visible = useContext(PanelVisibleContext);
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
    if (visible) {
      rerender();
    }
  }, [visible]);

  useEffect(() => {
    const perf = performance as PerformanceWithMemory;
    let frames = 0;
    let updates = 0;
    let messages = 0;
    let recordingMs = 0;
    let playingUpdates = 0;
    let lastActiveData: Immutable<PlayerStateActiveData> | undefined;
    let bytesAtLastTick: number | undefined;
    let playerId: string | undefined;

    let rafId = requestAnimationFrame(function onFrame() {
      frames++;
      rafId = requestAnimationFrame(onFrame);
    });

    const onPipelineState = (state: MessagePipelineContext) => {
      const s = stats.current;
      if (state.playerState.playerId !== playerId) {
        // New source: per-source state from the old one would show as spikes or stale maxima.
        playerId = state.playerState.playerId;
        lastActiveData = s.activeData = bytesAtLastTick = undefined;
        s.topics.clear();
      }
      s.subscriptions = state.subscriptions;
      s.progress = state.playerState.progress;
      const activeData = state.playerState.activeData;
      if (!activeData || activeData === lastActiveData) {
        return;
      }
      updates++;
      messages += activeData.messages.length;
      for (const msg of activeData.messages) {
        let topic = s.topics.get(msg.topic);
        if (!topic) {
          topic = { recent: [], bytesThisTick: 0, nowBps: 0, maxBps: 0 };
          s.topics.set(msg.topic, topic);
        }
        topic.bytesThisTick += msg.sizeInBytes;
      }
      if (
        lastActiveData?.isPlaying === true &&
        activeData.isPlaying &&
        lastActiveData.lastSeekTime === activeData.lastSeekTime
      ) {
        recordingMs +=
          toSec(subtractTimes(activeData.currentTime, lastActiveData.currentTime)) * 1000;
        playingUpdates++;
      }
      s.activeData = activeData;
      lastActiveData = activeData;
    };
    onPipelineState(getPipelineState());
    const unsubscribe = subscribe(onPipelineState);

    let disposed = false;
    let pageMemoryTimer: ReturnType<typeof setTimeout> | undefined;
    // Needs cross-origin isolation; unavailable outside Chromium. A measurement can take longer
    // than the interval, so the next one is scheduled only after the previous one settles.
    if (perf.measureUserAgentSpecificMemory && window.crossOriginIsolated) {
      const measure = () => {
        perf
          .measureUserAgentSpecificMemory?.()
          .then((result) => {
            stats.current.pageBytes = result.bytes;
          })
          .catch(() => {})
          .finally(() => {
            if (!disposed) {
              pageMemoryTimer = setTimeout(measure, PAGE_MEMORY_INTERVAL_MS);
            }
          });
      };
      measure();
    }

    let lastTick = performance.now();
    let scheduledAt = lastTick;
    let skipNextSample = false;
    let tickTimer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      scheduledAt = performance.now();
      tickTimer = setTimeout(tick, TICK_MS);
    };
    const tick = () => {
      const now = performance.now();
      const dtMs = now - lastTick;
      lastTick = now;
      const dtSec = dtMs / 1000;
      const timestamp = Date.now();
      const s = stats.current;
      const push = (key: Series, value: number) => {
        s.series[key].push({ value, timestamp });
      };

      // Hidden tabs throttle timers and pause frames; sampling then would show false stalls.
      const skip = document.hidden || skipNextSample;
      skipNextSample = document.hidden;
      if (!skip) {
        push("renderFps", frames / dtSec);
        // The timer fires late by however long the main thread was busy.
        push("eventLoopLagMs", Math.max(0, now - scheduledAt - TICK_MS));
      }
      push("updatesPerSec", updates / dtSec);
      push("messagesPerSec", messages / dtSec);
      if (playingUpdates > 0) {
        push("speed", recordingMs / dtMs);
        push("recordingMsPerUpdate", recordingMs / playingUpdates);
      }
      const totalBytes = s.activeData?.totalBytesReceived;
      if (totalBytes != undefined) {
        if (bytesAtLastTick != undefined && totalBytes >= bytesAtLastTick) {
          push("sourceBitsPerSec", ((totalBytes - bytesAtLastTick) * 8) / dtSec);
        }
        bytesAtLastTick = totalBytes;
      }
      for (const topic of s.topics.values()) {
        topic.recent.push(topic.bytesThisTick);
        topic.bytesThisTick = 0;
        if (topic.recent.length > TOPIC_NOW_TICKS) {
          topic.recent.shift();
        }
        const bytes = topic.recent.reduce((sum, b) => sum + b, 0);
        topic.nowBps = (bytes * 8) / ((topic.recent.length * TICK_MS) / 1000);
        topic.maxBps = Math.max(topic.maxBps, topic.nowBps);
      }
      s.heap = perf.memory;
      for (const points of Object.values(s.series)) {
        while (points[0] && points[0].timestamp < timestamp - TIME_RANGE_MS) {
          points.shift();
        }
      }

      frames = updates = messages = recordingMs = playingUpdates = 0;
      if (!document.hidden && visibleRef.current) {
        rerender();
      }
      schedule();
    };
    schedule();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      clearTimeout(tickTimer);
      clearTimeout(pageMemoryTimer);
      unsubscribe();
    };
  }, [getPipelineState, subscribe]);

  return stats.current;
}

const useStyles = makeStyles()((theme) => ({
  root: {
    flex: "auto",
    overflowY: "auto",
    padding: theme.spacing(1, 1.5, 2),
    fontVariantNumeric: "tabular-nums",
  },
  section: {
    marginTop: theme.spacing(2),
    "&:first-of-type": { marginTop: theme.spacing(0.5) },
  },
  header: {
    fontWeight: 600,
    letterSpacing: "0.06em",
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(0.5),
  },
  row: {
    display: "flex",
    alignItems: "baseline",
    gap: theme.spacing(1),
    minHeight: 22,
  },
  label: {
    flex: "auto",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  value: { flex: "none", textAlign: "right", minWidth: 80 },
  muted: { color: theme.palette.text.secondary },
  chartRow: { display: "flex", alignItems: "center", gap: theme.spacing(1.5) },
  chart: { flex: "auto", minWidth: 0 },
  chartValue: { flex: "none", textAlign: "right", width: 104 },
}));

function Section(props: { title: string; children: React.ReactNode }): ReactElement {
  const { classes } = useStyles();
  return (
    <div className={classes.section}>
      <Typography variant="overline" component="div" className={classes.header}>
        {props.title}
      </Typography>
      {props.children}
    </div>
  );
}

function Row(props: { label: React.ReactNode; values: React.ReactNode[] }): ReactElement {
  const { classes } = useStyles();
  return (
    <div className={classes.row}>
      <Typography variant="body2" className={classes.label}>
        {props.label}
      </Typography>
      {props.values.map((value, i) => (
        <Typography key={i} variant="body2" className={classes.value}>
          {value}
        </Typography>
      ))}
    </div>
  );
}

function ChartRow(props: {
  label: string;
  points: SparklinePoint[];
  maximum: number;
  format: (value: number) => string;
}): ReactElement {
  const { classes } = useStyles();
  const { points, format } = props;
  // A series that stopped (e.g. speed while paused) shows no current value.
  const lastPoint = points.at(-1);
  const last = lastPoint && lastPoint.timestamp >= Date.now() - 2 * TICK_MS ? lastPoint : undefined;
  const avg =
    points.length > 0 ? points.reduce((sum, p) => sum + p.value, 0) / points.length : undefined;
  return (
    <div className={classes.section}>
      <Typography variant="body2">{props.label}</Typography>
      <div className={classes.chartRow}>
        <div className={classes.chart}>
          <Sparkline
            points={points}
            maximum={props.maximum}
            width="100%"
            height={36}
            timeRange={TIME_RANGE_MS}
          />
        </div>
        <div className={classes.chartValue}>
          <Typography variant="body2">{last ? format(last.value) : "—"}</Typography>
          <Typography variant="caption" className={classes.muted}>
            {avg != undefined ? `${format(avg)} avg` : "— avg"}
          </Typography>
        </div>
      </div>
    </div>
  );
}

const DASH = "—";

function PlaybackPerformance(): ReactElement {
  const { classes } = useStyles();
  const stats = usePerformanceStats();
  const { series, heap, pageBytes, progress } = stats;

  const fullTopics = new Set<string>();
  const playheadTopics = new Set<string>();
  for (const sub of stats.subscriptions) {
    (sub.preloadType === "full" ? fullTopics : playheadTopics).add(sub.topic);
  }
  const topicRows = [...playheadTopics]
    .map((topic) => ({ topic, rate: stats.topics.get(topic) }))
    .sort((a, b) => (b.rate?.maxBps ?? 0) - (a.rate?.maxBps ?? 0));
  const loadedFraction = progress?.fullyLoadedFractionRanges?.reduce(
    (sum, range) => sum + range.end - range.start,
    0,
  );
  const playerMemory = Object.entries(progress?.memoryInfo ?? {});
  const targetSpeed = stats.activeData?.speed;

  return (
    <Stack flex="auto" overflow="hidden">
      <PanelToolbar />
      <div className={classes.root}>
        <Section title="Data loading">
          <Row
            label="Subscribed topics"
            values={[new Set([...playheadTopics, ...fullTopics]).size]}
          />
          <Row label="Preloaded topics" values={[fullTopics.size]} />
          {loadedFraction != undefined && (
            <Row
              label="Recording loaded"
              values={[`${(Math.min(1, loadedFraction) * 100).toFixed(0)}%`]}
            />
          )}
          {topicRows.length > 0 && (
            <>
              <Row
                label={<span className={classes.muted}>Messages at playhead</span>}
                values={[
                  <span key="now" className={classes.muted}>
                    Now
                  </span>,
                  <span key="max" className={classes.muted}>
                    Max
                  </span>,
                ]}
              />
              {topicRows.map(({ topic, rate }) => (
                <Row
                  key={topic}
                  label={topic}
                  values={[
                    rate ? formatBitRate(rate.nowBps) : DASH,
                    rate ? formatBitRate(rate.maxBps) : DASH,
                  ]}
                />
              ))}
            </>
          )}
        </Section>

        <Section title="Memory">
          {heap ? (
            <>
              <Row label="JS heap used" values={[formatByteSize(heap.usedJSHeapSize)]} />
              <Row label="JS heap allocated" values={[formatByteSize(heap.totalJSHeapSize)]} />
              <Row label="JS heap limit" values={[formatByteSize(heap.jsHeapSizeLimit)]} />
            </>
          ) : (
            <Row label="JS heap" values={["Not reported by this browser"]} />
          )}
          {pageBytes != undefined && (
            <Row label="Page and workers" values={[formatByteSize(pageBytes)]} />
          )}
        </Section>

        {playerMemory.length > 0 && (
          <Section title="Player memory">
            {playerMemory.map(([name, bytes]) => (
              <Row key={name} label={name} values={[formatByteSize(bytes)]} />
            ))}
          </Section>
        )}

        <Section title="Main thread">
          <ChartRow
            label="Display frame rate"
            points={series.renderFps}
            maximum={60}
            format={(v) => `${v.toFixed(0)} fps`}
          />
          <ChartRow
            label="Event loop latency"
            points={series.eventLoopLagMs}
            maximum={50}
            format={(v) => `${v.toFixed(1)} ms`}
          />
        </Section>

        <Section title="Data pipeline">
          <ChartRow
            label={
              targetSpeed != undefined
                ? `Playback speed (target ${targetSpeed}×)`
                : "Playback speed"
            }
            points={series.speed}
            maximum={1.6}
            format={(v) => `${v.toFixed(2)}× realtime`}
          />
          <ChartRow
            label="Player updates"
            points={series.updatesPerSec}
            maximum={60}
            format={(v) => `${v.toFixed(0)} /s`}
          />
          <ChartRow
            label="Recording time per update"
            points={series.recordingMsPerUpdate}
            maximum={100}
            format={(v) => `${v.toFixed(0)} ms`}
          />
          <ChartRow
            label="Messages delivered"
            points={series.messagesPerSec}
            maximum={100}
            format={(v) => `${v.toFixed(0)} /s`}
          />
          <ChartRow
            label="Source throughput"
            points={series.sourceBitsPerSec}
            maximum={10e6}
            format={formatBitRate}
          />
        </Section>
      </div>
    </Stack>
  );
}

PlaybackPerformance.panelType = "PlaybackPerformance";
PlaybackPerformance.defaultConfig = {};

export default Panel(PlaybackPerformance);
