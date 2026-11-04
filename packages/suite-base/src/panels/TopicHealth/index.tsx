// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time, subtract, toSec } from "@foxglove/rostime";
import InsightsIcon from "@mui/icons-material/Insights";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SearchIcon from "@mui/icons-material/Search";
import { IconButton, InputBase, Tooltip } from "@mui/material";
import { produce } from "immer";
import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatByteSize } from "@lichtblick/den/format";
import { MessageEvent, SettingsTreeAction } from "@lichtblick/suite";
import { useMessageReducer } from "@lichtblick/suite-base/PanelAPI";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Panel from "@lichtblick/suite-base/components/Panel";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import {
  InspectionState,
  TopicInspection,
  createInspectionState,
  finishInspection,
  inspectSourceTopics,
  updateInspection,
} from "@lichtblick/suite-base/panels/DataSourceInfo/inspection";
import {
  TopicTreeRow,
  topicTreeRows,
} from "@lichtblick/suite-base/panels/DataSourceInfo/topicTree";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import { Topic, TopicStats } from "@lichtblick/suite-base/players/types";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { toError } from "@lichtblick/suite-base/util/toError";

import {
  DEFAULT_CONFIG,
  DEFAULT_TOLERANCE_PERCENT,
  RateSample,
  STATUS_ORDER,
  TopicHealthConfig,
  TopicHealthStatus,
  TopicSettings,
  averageRate,
  recordingAge,
  recordingRate,
  sampleLiveRates,
  staleAfterSec,
  topicStatus,
} from "./health";
import { useStyles } from "./index.style";
import { buildSettingsTree } from "./settings";

const SAMPLE_INTERVAL_MS = 1000;
const STATUSES: TopicHealthStatus[] = ["ok", "slow", "stale", "unmeasured"];
const STATUS_LABELS: Record<TopicHealthStatus, string> = {
  ok: "OK",
  slow: "Slow",
  stale: "Stale",
  unmeasured: "Not measured",
};

const selectTopics = (ctx: MessagePipelineContext) => ctx.sortedTopics;
const selectCapabilities = (ctx: MessagePipelineContext) => ctx.playerState.capabilities;
const selectPlayerId = (ctx: MessagePipelineContext) => ctx.playerState.playerId;
const selectStart = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEnd = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectBatchIterator = (ctx: MessagePipelineContext) => ctx.getBatchIterator;
const selectInspectionIterator = (ctx: MessagePipelineContext) => ctx.getInspectionIterator;

type Snapshot = {
  stats?: ReadonlyMap<string, TopicStats>;
  currentTime?: Time;
  nowMs: number;
  live: ReadonlyMap<string, RateSample>;
  /** Live detailed statistics with bytes per second over the last sample. */
  deep: ReadonlyMap<string, { inspection: TopicInspection; bytesPerSec?: number }>;
};

type Row = {
  topic: Topic;
  status: TopicHealthStatus;
  rateHz?: number;
  expectedHz?: number;
  autoExpected: boolean;
  ageSec?: number;
  history?: readonly number[];
  inspection?: TopicInspection;
  bytesPerSec?: number;
};

function formatHz(hz: number | undefined): string {
  if (hz == undefined) {
    return "—";
  }
  return hz >= 100 ? hz.toFixed(0) : hz >= 10 ? hz.toFixed(1) : hz.toFixed(2);
}

function formatSeconds(seconds: number | undefined): string {
  if (seconds == undefined) {
    return "—";
  }
  return seconds < 1 ? `${(seconds * 1000).toFixed(0)} ms` : `${seconds.toFixed(1)} s`;
}

function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  const { classes } = useStyles();
  if (values.length < 2) {
    return <span className={classes.muted}>—</span>;
  }
  const max = Math.max(...values, Number.EPSILON);
  const points = values
    .map((value, index) => `${(index / (values.length - 1)) * 100},${20 - (value / max) * 18}`)
    .join(" ");
  return (
    <svg className={classes.sparkline} viewBox="0 0 100 20" preserveAspectRatio="none" role="img">
      <title>{label}</title>
      <polyline points={points} />
    </svg>
  );
}

function ExpectedInput({
  row,
  onChange,
}: {
  row: Row;
  onChange: (value: number | undefined) => void;
}): React.JSX.Element {
  const { classes, cx } = useStyles();
  const [draft, setDraft] = useState<string>();
  const shown = row.autoExpected ? "" : String(row.expectedHz ?? "");
  const commit = () => {
    if (draft == undefined) {
      return;
    }
    const value = draft.trim() === "" ? undefined : Number(draft);
    if (value == undefined || (Number.isFinite(value) && value >= 0)) {
      onChange(value);
    }
    setDraft(undefined);
  };
  return (
    <InputBase
      className={cx(classes.expected, row.autoExpected && classes.muted)}
      value={draft ?? shown}
      placeholder={row.expectedHz != undefined ? `auto ${formatHz(row.expectedHz)}` : "auto"}
      inputProps={{
        inputMode: "decimal",
        "aria-label": `Expected rate for ${row.topic.name}`,
      }}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
        } else if (event.key === "Escape") {
          setDraft(undefined);
        }
      }}
    />
  );
}

type Props = {
  config: TopicHealthConfig;
  saveConfig: SaveConfig<TopicHealthConfig>;
};

function TopicHealthTable({ config, saveConfig }: Props): React.JSX.Element {
  const { classes, cx } = useStyles();
  const topics = useMessagePipeline(selectTopics);
  const capabilities = useMessagePipeline(selectCapabilities);
  const start = useMessagePipeline(selectStart);
  const end = useMessagePipeline(selectEnd);
  const getBatchIterator = useMessagePipeline(selectBatchIterator);
  const getInspectionIterator = useMessagePipeline(selectInspectionIterator);
  const getPipeline = useMessagePipelineGetter();
  const { openSiblingPanel } = usePanelContext();
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const isRecording = capabilities.includes(PLAYER_CAPABILITIES.playbackControl);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<TopicHealthStatus>();
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [scanError, setScanError] = useState<string>();
  const [recorded, setRecorded] = useState(new Map<string, TopicInspection>());

  const deepTopics = useMemo(
    () =>
      Object.entries(config.topics)
        .filter(([, settings]) => settings.deepStats === true)
        .map(([name]) => name)
        .sort(),
    [config.topics],
  );

  // Live detailed stats accumulate in a mutable map; returning the same reference avoids
  // re-rendering per message, and the sampling tick below reads it.
  const liveDeep = useMessageReducer<Map<string, InspectionState>>({
    topics: isRecording ? [] : deepTopics,
    restore: useCallback((previous?: Map<string, InspectionState>) => previous ?? new Map(), []),
    addMessages: useCallback(
      (states: Map<string, InspectionState>, events: readonly MessageEvent[]) => {
        for (const event of events) {
          let state = states.get(event.topic);
          if (!state) {
            state = createInspectionState();
            states.set(event.topic, state);
          }
          updateInspection(state, event);
        }
        return states;
      },
      [],
    ),
  });
  const liveDeepRef = useRef(liveDeep);
  liveDeepRef.current = liveDeep;
  useEffect(() => {
    // Forget topics that were opted out so re-enabling does not report the pause as a gap.
    for (const topic of liveDeep.keys()) {
      if (!deepTopics.includes(topic)) {
        liveDeep.delete(topic);
      }
    }
  }, [deepTopics, liveDeep]);

  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    nowMs: Date.now(),
    live: new Map(),
    deep: new Map(),
  }));
  useEffect(() => {
    const tick = () => {
      const { activeData } = getPipeline().playerState;
      const nowMs = Date.now();
      setSnapshot((previous) => {
        const deep = new Map<string, { inspection: TopicInspection; bytesPerSec?: number }>();
        for (const [topic, state] of liveDeepRef.current) {
          const before = previous.deep.get(topic)?.inspection.bytes;
          const seconds = (nowMs - previous.nowMs) / 1000;
          deep.set(topic, {
            inspection: finishInspection(state),
            bytesPerSec:
              before != undefined && seconds > 0
                ? (state.result.bytes - before) / seconds
                : undefined,
          });
        }
        return {
          stats: activeData?.topicStats,
          currentTime: activeData?.currentTime,
          nowMs,
          live: isRecording
            ? previous.live
            : sampleLiveRates(previous.live, activeData?.topicStats, nowMs),
          deep,
        };
      });
    };
    tick();
    const id = setInterval(tick, SAMPLE_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, [getPipeline, isRecording]);

  // Recordings: scan opted-in topics once over the whole source instead of subscribing.
  useEffect(() => {
    const pending = deepTopics.filter(
      (name) => !recorded.has(name) && topics.some((topic) => topic.name === name),
    );
    if (!isRecording || !start || !end || pending.length === 0) {
      return;
    }
    const controller = new AbortController();
    setScanError(undefined);
    inspectSourceTopics({
      pipeline: { getBatchIterator, getInspectionIterator },
      topics,
      names: pending,
      start,
      end,
      signal: controller.signal,
      onProgress: () => {},
      onResult: (results) => {
        setRecorded((previous) => new Map([...previous, ...results]));
      },
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) {
        setScanError(toError(err).message);
      }
    });
    return () => {
      controller.abort();
    };
  }, [
    deepTopics,
    end,
    getBatchIterator,
    getInspectionIterator,
    isRecording,
    recorded,
    start,
    topics,
  ]);

  const updateTopic = useCallback(
    (topic: string, change: Partial<TopicSettings>) => {
      saveConfig(
        produce<TopicHealthConfig>((draft) => {
          const next = _.omitBy({ ...draft.topics[topic], ...change }, _.isUndefined);
          if (_.isEmpty(next)) {
            delete draft.topics[topic];
          } else {
            draft.topics[topic] = next;
          }
        }),
      );
    },
    [saveConfig],
  );

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      const [section, topic, field] = action.payload.path;
      if (action.action === "perform-node-action") {
        if (section === "topics" && topic != undefined && action.payload.id === "remove") {
          saveConfig(
            produce<TopicHealthConfig>((draft) => {
              delete draft.topics[topic];
            }),
          );
        }
        return;
      }
      if (action.action !== "update") {
        return;
      }
      const { value } = action.payload;
      if (section === "general" && topic != undefined) {
        saveConfig({ [topic]: value });
      } else if (section === "topics" && topic != undefined && field != undefined) {
        updateTopic(topic, { [field]: value === false ? undefined : value });
      }
    },
    [saveConfig, updateTopic],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: buildSettingsTree(config),
    });
  }, [actionHandler, config, updatePanelSettingsTree]);

  const rows = useMemo(() => {
    const result = new Map<string, Row>();
    for (const topic of topics) {
      const settings = config.topics[topic.name];
      const stat = snapshot.stats?.get(topic.name);
      const live = snapshot.live.get(topic.name);
      const liveDeepStats = snapshot.deep.get(topic.name);
      const inspection = isRecording ? recorded.get(topic.name) : liveDeepStats?.inspection;
      // Indexed MCAP only reports counts, so fall back to the scan, then to the source duration.
      const scanned = inspection && {
        numMessages: inspection.count,
        firstMessageTime: inspection.first,
        lastMessageTime: inspection.last,
      };
      const rateHz = isRecording
        ? (recordingRate(stat) ?? recordingRate(scanned) ?? averageRate(stat, start, end))
        : live?.hz;
      // Recordings learn the median rate once scanned, else the average (still catches early ends).
      const learnedHz = isRecording ? (inspection?.timing?.medianHz ?? rateHz) : live?.peakHz;
      const expectedHz = settings?.expectedHz ?? learnedHz;
      const ageSec = isRecording
        ? (recordingAge(stat, snapshot.currentTime) ?? recordingAge(scanned, snapshot.currentTime))
        : live?.lastMessageMs != undefined
          ? (snapshot.nowMs - live.lastMessageMs) / 1000
          : undefined;
      result.set(topic.name, {
        topic,
        rateHz,
        expectedHz,
        autoExpected: settings?.expectedHz == undefined,
        ageSec,
        history: live?.history,
        inspection,
        bytesPerSec: isRecording ? recordedBandwidth(inspection) : liveDeepStats?.bytesPerSec,
        status: topicStatus({
          rateHz,
          expectedHz,
          ageSec,
          staleAfterSec: staleAfterSec(settings, expectedHz),
          tolerancePercent: config.tolerancePercent ?? DEFAULT_TOLERANCE_PERCENT,
        }),
      });
    }
    return result;
  }, [config, end, isRecording, recorded, snapshot, start, topics]);

  const counts = useMemo(() => _.countBy([...rows.values()], (row) => row.status), [rows]);

  const visibleTopics = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return topics.filter((topic) => {
      const row = rows.get(topic.name);
      return (
        (statusFilter == undefined || row?.status === statusFilter) &&
        (needle === "" ||
          topic.name.toLowerCase().includes(needle) ||
          (topic.schemaName?.toLowerCase().includes(needle) ?? false))
      );
    });
  }, [query, rows, statusFilter, topics]);

  const treeRows = useMemo(() => {
    const rank = (group: readonly Topic[]) =>
      Math.min(...group.map((topic) => STATUS_ORDER[rows.get(topic.name)?.status ?? "ok"]));
    const byName = (left: readonly Topic[], right: readonly Topic[]) =>
      left[0]!.name.localeCompare(right[0]!.name);
    const tree = topicTreeRows(
      visibleTopics,
      collapsed,
      config.sortByStatus === true
        ? (left, right) =>
            rank(left) !== rank(right) ? rank(left) - rank(right) : byName(left, right)
        : byName,
    );
    // Single-topic namespaces and namespaces that only wrap one deeper namespace add noise; drop
    // them and re-indent by the remaining ancestors.
    const namespaces = tree.flatMap((row) => (row.kind === "namespace" ? [row] : []));
    const kept = namespaces
      .filter(
        (row) =>
          row.count > 1 &&
          !namespaces.some(
            (child) => child.count === row.count && child.path.startsWith(`${row.path}/`),
          ),
      )
      .map((row) => row.path);
    const keptSet = new Set(kept);
    const depth = (name: string) =>
      kept.filter((path) => name !== path && name.startsWith(`${path}/`)).length;
    return tree.flatMap((row): TopicTreeRow[] =>
      row.kind === "namespace"
        ? keptSet.has(row.path)
          ? [{ ...row, depth: depth(row.path) }]
          : []
        : [{ ...row, depth: depth(row.topic.name) }],
    );
  }, [collapsed, config.sortByStatus, rows, visibleTopics]);

  const openTopic = (name: string) => {
    openSiblingPanel({
      panelType: "RawMessages",
      updateIfExists: true,
      siblingConfigCreator: (panelConfig) => ({
        ...panelConfig,
        topicPath: name,
      }),
    });
  };

  const toggleCollapsed = (path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) {
        next.add(path);
      }
      return next;
    });
  };

  const showDeep = deepTopics.length > 0;

  return (
    <>
      <PanelToolbar>
        <div className={classes.toolbar}>
          <SearchIcon fontSize="small" className={classes.muted} />
          <InputBase
            className={classes.search}
            value={query}
            placeholder="Filter topics or schemas"
            inputProps={{ "aria-label": "Filter topics" }}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
      </PanelToolbar>
      <div className={classes.summary}>
        {STATUSES.filter(
          (status) =>
            status !== "unmeasured" || counts[status] != undefined || statusFilter === status,
        ).map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={statusFilter === status}
            className={cx(
              classes.chip,
              classes[status],
              statusFilter === status && classes.chipActive,
            )}
            onClick={() => {
              setStatusFilter(statusFilter === status ? undefined : status);
            }}
          >
            {counts[status] ?? 0} {STATUS_LABELS[status]}
          </button>
        ))}
        {scanError != undefined && <span className={classes.error}>{scanError}</span>}
      </div>
      <div className={classes.root}>
        {topics.length === 0 ? (
          <EmptyState>Waiting for topics…</EmptyState>
        ) : (
          <table className={classes.table}>
            <thead>
              <tr>
                <th>Topic</th>
                <th className={classes.number}>Rate (Hz)</th>
                <th className={classes.number}>Expected</th>
                <th className={classes.number}>Since last msg</th>
                {!isRecording && <th>History</th>}
                {showDeep && (
                  <>
                    <th className={classes.number}>Jitter</th>
                    <th className={classes.number}>Max gap</th>
                    <th className={classes.number}>Bandwidth</th>
                    {isRecording && <th>Activity</th>}
                  </>
                )}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {treeRows.map((treeRow) => {
                if (treeRow.kind === "namespace") {
                  const isCollapsed = collapsed.has(treeRow.path);
                  const problems = treeRow.topics.filter((topic) => {
                    const status = rows.get(topic.name)?.status;
                    return status === "slow" || status === "stale";
                  }).length;
                  return (
                    <tr key={`ns:${treeRow.path}`} className={classes.namespace}>
                      <td colSpan={99} style={{ paddingLeft: 4 + treeRow.depth * 16 }}>
                        <button
                          type="button"
                          className={classes.namespaceButton}
                          aria-expanded={!isCollapsed}
                          onClick={() => {
                            toggleCollapsed(treeRow.path);
                          }}
                        >
                          {isCollapsed ? (
                            <KeyboardArrowRightIcon fontSize="inherit" />
                          ) : (
                            <KeyboardArrowDownIcon fontSize="inherit" />
                          )}
                          {treeRow.path}
                          <span className={classes.muted}>
                            {treeRow.count} topics
                            {problems > 0 ? ` · ${problems} unhealthy` : ""}
                          </span>
                        </button>
                      </td>
                    </tr>
                  );
                }
                const row = rows.get(treeRow.topic.name)!;
                const deep = config.topics[row.topic.name]?.deepStats === true;
                const timing = row.inspection?.timing;
                return (
                  <tr key={row.topic.name}>
                    <td style={{ paddingLeft: 4 + treeRow.depth * 16 }}>
                      <span
                        className={cx(classes.dot, classes[row.status])}
                        title={
                          row.status === "unmeasured"
                            ? isRecording
                              ? "Not measured: this source has no message counts for the topic. Enable detailed statistics to scan it."
                              : "Not measured: no panel subscribes to this topic. Enable detailed statistics to measure it."
                            : STATUS_LABELS[row.status]
                        }
                      />
                      <button
                        type="button"
                        className={classes.topicButton}
                        title={`Open ${row.topic.name} in Raw Messages`}
                        onClick={() => {
                          openTopic(row.topic.name);
                        }}
                      >
                        {row.topic.name}
                      </button>
                      {row.topic.schemaName != undefined && (
                        <span className={classes.schema}>{row.topic.schemaName}</span>
                      )}
                    </td>
                    <td className={classes.number}>{formatHz(row.rateHz)}</td>
                    <td className={classes.number}>
                      <ExpectedInput
                        row={row}
                        onChange={(expectedHz) => {
                          updateTopic(row.topic.name, { expectedHz });
                        }}
                      />
                    </td>
                    <td className={classes.number}>
                      {isRecording && row.ageSec === 0 ? "—" : formatSeconds(row.ageSec)}
                    </td>
                    {!isRecording && (
                      <td>
                        <Sparkline
                          values={row.history ?? []}
                          label={`${row.topic.name} rate history`}
                        />
                      </td>
                    )}
                    {showDeep && (
                      <>
                        <td className={classes.number}>
                          {timing ? formatSeconds(timing.jitterNs / 1e9) : "—"}
                        </td>
                        <td className={classes.number}>
                          {row.inspection?.largestInterval
                            ? formatSeconds(
                                Number(row.inspection.largestInterval.nanoseconds) / 1e9,
                              )
                            : "—"}
                        </td>
                        <td className={classes.number}>
                          {row.bytesPerSec != undefined
                            ? `${formatByteSize(row.bytesPerSec)}/s`
                            : "—"}
                        </td>
                        {isRecording && (
                          <td>
                            {row.inspection ? (
                              <Sparkline
                                values={row.inspection.buckets}
                                label={`${row.topic.name} activity over the recording`}
                              />
                            ) : (
                              <span className={classes.muted}>{deep ? "Scanning…" : "—"}</span>
                            )}
                          </td>
                        )}
                      </>
                    )}
                    <td className={classes.actions}>
                      <Tooltip
                        title={
                          deep
                            ? "Hide detailed statistics"
                            : isRecording
                              ? "Scan for jitter, gaps and bandwidth"
                              : "Subscribe for jitter, gaps and bandwidth"
                        }
                      >
                        <IconButton
                          size="small"
                          color={deep ? "primary" : "default"}
                          aria-pressed={deep}
                          aria-label={`Detailed statistics for ${row.topic.name}`}
                          onClick={() => {
                            updateTopic(row.topic.name, {
                              deepStats: deep ? undefined : true,
                            });
                          }}
                        >
                          <InsightsIcon fontSize="inherit" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Open in Raw Messages">
                        <IconButton
                          size="small"
                          aria-label={`Open ${row.topic.name} in Raw Messages`}
                          onClick={() => {
                            openTopic(row.topic.name);
                          }}
                        >
                          <OpenInNewIcon fontSize="inherit" />
                        </IconButton>
                      </Tooltip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function recordedBandwidth(inspection: TopicInspection | undefined): number | undefined {
  if (!inspection?.first || !inspection.last) {
    return undefined;
  }
  const seconds = toSec(subtract(inspection.last, inspection.first));
  return seconds > 0 ? inspection.bytes / seconds : undefined;
}

function TopicHealth(props: Props): React.JSX.Element {
  // Reset sampled rates and scans when the data source changes.
  const playerId = useMessagePipeline(selectPlayerId);
  return <TopicHealthTable key={playerId} {...props} />;
}

TopicHealth.panelType = "TopicHealth";
TopicHealth.defaultConfig = DEFAULT_CONFIG;

export default Panel(TopicHealth);
