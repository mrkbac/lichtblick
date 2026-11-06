// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time, subtract, toSec } from "@foxglove/rostime";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Button,
  Chip,
  InputAdornment,
  IconButton,
  LinearProgress,
  MenuItem,
  Tab,
  TableSortLabel,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { Fragment, useEffect, useRef, useState } from "react";

import { formatByteSize } from "@lichtblick/den/format";
import CopyButton from "@lichtblick/suite-base/components/CopyButton";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Panel from "@lichtblick/suite-base/components/Panel";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import { Topic } from "@lichtblick/suite-base/players/types";
import { formatDuration } from "@lichtblick/suite-base/util/formatTime";

import { ActivityChart, ContainerDetails, KeyValueTable, SchemaFields } from "./InspectionViews";
import { useStyles } from "./index.style";
import { aggregateBuckets, BUCKET_COUNT, inspectSourceTopics, TopicInspection } from "./inspection";
import { namespaceTotals, topicTreeRows } from "./topicTree";

const selectTopics = (ctx: MessagePipelineContext) => ctx.sortedTopics;
const selectStats = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.topicStats;
const selectStart = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEnd = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectName = (ctx: MessagePipelineContext) => ctx.playerState.name;
const selectCapabilities = (ctx: MessagePipelineContext) => ctx.playerState.capabilities;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectPause = (ctx: MessagePipelineContext) => ctx.pausePlayback;
const selectIterator = (ctx: MessagePipelineContext) => ctx.getBatchIterator;
const selectInspectionIterator = (ctx: MessagePipelineContext) => ctx.getInspectionIterator;
const selectMetadata = (ctx: MessagePipelineContext) => ctx.getMetadata;
const selectDatatypes = (ctx: MessagePipelineContext) => ctx.datatypes;
const selectPlayerId = (ctx: MessagePipelineContext) => ctx.playerState.playerId;

type SortKey =
  | "topic"
  | "schema"
  | "messages"
  | "rate"
  | "size"
  | "throughput"
  | "average"
  | "interval"
  | "median"
  | "jitter";
const selectFiles = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.recordingFiles;

function offset(time: Time, start: Time): string {
  return `${toSec(subtract(time, start)).toFixed(2)} s`;
}

export function RecordingInspector(): React.JSX.Element {
  const { classes, cx } = useStyles();
  const topics = useMessagePipeline(selectTopics);
  const getPipeline = useMessagePipelineGetter();
  // Live players emit a new topicStats map per message, so sample it instead of re-rendering per emit.
  const [topicStats, setTopicStats] = useState(() => selectStats(getPipeline()));
  useEffect(() => {
    const id = setInterval(() => {
      setTopicStats(selectStats(getPipeline()));
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [getPipeline]);
  const start = useMessagePipeline(selectStart);
  const end = useMessagePipeline(selectEnd);
  const name = useMessagePipeline(selectName);
  const capabilities = useMessagePipeline(selectCapabilities);
  const seek = useMessagePipeline(selectSeek);
  const pause = useMessagePipeline(selectPause);
  const getIterator = useMessagePipeline(selectIterator);
  const getInspectionIterator = useMessagePipeline(selectInspectionIterator);
  const getMetadata = useMessagePipeline(selectMetadata);
  const datatypes = useMessagePipeline(selectDatatypes);
  const files = useMessagePipeline(selectFiles) ?? [];
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("topic");
  const [ascending, setAscending] = useState(true);
  const [rateBasis, setRateBasis] = useState("recording");
  const [tree, setTree] = useState(false);
  const [showActivity, setShowActivity] = useState(true);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [tab, setTab] = useState("topics");
  const [inspections, setInspections] = useState(new Map<string, TopicInspection>());
  const [selected, setSelected] = useState<string>();
  const [scanning, setScanning] = useState<string>();
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string>();
  const controller = useRef<AbortController>(undefined);
  const metadata = getMetadata();
  const isRecording = capabilities.includes(PLAYER_CAPABILITIES.playbackControl);
  const schemas = [
    ...new Set(topics.flatMap((topic) => (topic.schemaName ? [topic.schemaName] : []))),
  ];
  const durationSeconds = start && end ? toSec(subtract(end, start)) : 0;
  const countFor = (topic: Topic) =>
    inspections.get(topic.name)?.count ?? topicStats?.get(topic.name)?.numMessages;
  const rateFor = (topic: Topic) => {
    const data = inspections.get(topic.name);
    if (rateBasis === "median") {
      return data?.timing?.medianHz;
    }
    if (rateBasis === "recording") {
      const count = countFor(topic);
      return count != undefined && durationSeconds > 0 ? count / durationSeconds : undefined;
    }
    const seconds = data?.first && data.last ? toSec(subtract(data.last, data.first)) : 0;
    return data && data.count > 1 && seconds > 0 ? (data.count - 1) / seconds : undefined;
  };
  const sortValue = (topic: Topic): string | number | undefined => {
    switch (sort) {
      case "median":
        return inspections.get(topic.name)?.timing?.medianHz;
      case "jitter":
        return inspections.get(topic.name)?.timing?.jitterNs;
      case "topic":
        return topic.name;
      case "schema":
        return topic.schemaName;
      case "throughput": {
        const data = inspections.get(topic.name);
        return data && durationSeconds > 0 ? data.bytes / durationSeconds : undefined;
      }
      case "average": {
        const data = inspections.get(topic.name);
        return data && data.count > 0 ? data.bytes / data.count : undefined;
      }
      case "messages":
        return countFor(topic);
      case "rate":
        return rateFor(topic);
      case "size":
        return inspections.get(topic.name)?.bytes;
      case "interval": {
        const interval = inspections.get(topic.name)?.largestInterval;
        return interval ? Number(interval.nanoseconds) : undefined;
      }
    }
  };
  const filtered = topics
    .filter((topic) =>
      `${topic.name} ${topic.schemaName ?? ""} ${topic.aliasedFromName ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) => {
      const left = sortValue(a);
      const right = sortValue(b);
      if (left == undefined) {
        return right == undefined ? a.name.localeCompare(b.name) : 1;
      }
      if (right == undefined) {
        return -1;
      }
      const comparison =
        typeof left === "string" && typeof right === "string"
          ? left.localeCompare(right)
          : Number(left) - Number(right);
      return comparison !== 0 ? comparison * (ascending ? 1 : -1) : a.name.localeCompare(b.name);
    });
  const knownCounts = topics.map(
    (topic) => inspections.get(topic.name)?.count ?? topicStats?.get(topic.name)?.numMessages,
  );
  const total = knownCounts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
  const allCountsKnown = knownCounts.every((count) => count != undefined);
  const aggregate = aggregateBuckets(inspections.values());
  const measuredCount = aggregate.reduce((sum, count) => sum + count, 0);
  const fileBytes =
    files.length > 0 && files.every((file) => file.sizeBytes != undefined)
      ? files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0)
      : undefined;
  const channelCount = files.reduce((sum, file) => sum + file.channels.length, 0);
  const estimatedSizes = [...inspections.values()].some((data) => data.estimatedBytes);
  const filename = name?.split("?")[0]?.split(/[\\/]/).at(-1);
  const displayName = filename == undefined || filename === "" ? "Data source info" : filename;
  const rows = tree
    ? topicTreeRows(filtered, collapsed, (left, right, leftKind, rightKind) => {
        const groupValue = (group: readonly Topic[], kind: "namespace" | "topic") => {
          if (kind === "topic") {
            return sortValue(group[0]!);
          }
          const totals = namespaceTotals(group, inspections, countFor);
          switch (sort) {
            case "messages":
              return totals.count;
            case "rate":
              return totals.count != undefined && durationSeconds > 0
                ? totals.count / durationSeconds
                : undefined;
            case "size":
              return totals.complete ? totals.bytes : undefined;
            case "throughput":
              return totals.complete && durationSeconds > 0
                ? totals.bytes / durationSeconds
                : undefined;
            case "average":
              return totals.complete && totals.count != undefined && totals.count > 0
                ? totals.bytes / totals.count
                : undefined;
            case "median":
            case "jitter":
            case "interval":
            case "schema":
              return undefined;
            default:
              return sortValue(group[0]!);
          }
        };
        const a = groupValue(left, leftKind);
        const b = groupValue(right, rightKind);
        if (a == undefined || b == undefined) {
          return a == undefined ? (b == undefined ? 0 : 1) : -1;
        }
        return (
          (typeof a === "string" && typeof b === "string"
            ? a.localeCompare(b)
            : Number(a) - Number(b)) * (ascending ? 1 : -1)
        );
      })
    : filtered.map((topic) => ({ kind: "topic" as const, topic, depth: 0 }));

  const sortHeading = (key: SortKey, label: string) => (
    <TableSortLabel
      active={sort === key}
      direction={ascending ? "asc" : "desc"}
      onClick={() => {
        setAscending(sort === key ? !ascending : key === "topic");
        setSort(key);
      }}
    >
      {label}
    </TableSortLabel>
  );

  useEffect(() => () => controller.current?.abort(), []);

  const scan = async (names: string[]) => {
    if (!start || !end || !isRecording || controller.current) {
      return;
    }
    const activeController = new AbortController();
    controller.current = activeController;
    setError(undefined);
    try {
      const pending = names.filter((topic) => !inspections.has(topic));
      if (pending.length === 0) {
        return;
      }
      setScanning(pending.length === 1 ? pending[0] : "selected topics");
      setProgress(`0 messages · ${pending.length} topics`);
      await inspectSourceTopics({
        pipeline: { getBatchIterator: getIterator, getInspectionIterator },
        topics,
        names: pending,
        start,
        end,
        signal: activeController.signal,
        onProgress: (count) => {
          setProgress(`${count.toLocaleString()} messages · ${pending.length} topics`);
        },
        onResult: (results) => {
          setInspections((previous) => new Map([...previous, ...results]));
        },
      });
    } catch (err) {
      if (!activeController.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (controller.current === activeController) {
        controller.current = undefined;
        setScanning(undefined);
      }
    }
  };

  const seekTo = (time: Time) => {
    pause?.();
    seek?.(time);
  };

  if (!start || !end) {
    return (
      <>
        <PanelToolbar />
        <EmptyState>Open a recording to inspect its topics and timing.</EmptyState>
      </>
    );
  }

  return (
    <>
      <PanelToolbar />
      <div className={classes.root}>
        <header className={classes.heading}>
          <Typography variant="subtitle1" noWrap title={name}>
            {displayName}
          </Typography>
          <div className={classes.actions}>
            <span className={classes.status}>
              {isRecording ? `${inspections.size}/${topics.length} scanned` : "Live source"}
            </span>
            <Button
              variant="contained"
              startIcon={<SearchIcon />}
              disabled={
                !isRecording ||
                scanning != undefined ||
                filtered.length === 0 ||
                filtered.every((topic) => inspections.has(topic.name))
              }
              onClick={() => void scan(filtered.map((topic) => topic.name))}
            >
              Scan {filtered.length} {filtered.length === 1 ? "topic" : "topics"}
            </Button>
          </div>
        </header>
        <div className={classes.metrics}>
          {[
            ["Duration", formatDuration(subtract(end, start)), "Full recording span"],
            [
              isRecording ? "Messages" : "Observed messages",
              allCountsKnown ? total.toLocaleString() : `${total.toLocaleString()} known`,
              `${durationSeconds > 0 ? (total / durationSeconds).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"} messages / second`,
            ],
            [
              "Topics",
              topics.length.toLocaleString(),
              `${schemas.length} ${schemas.length === 1 ? "schema" : "schemas"} · ${channelCount > 0 ? channelCount : "—"} channels`,
            ],
            [
              "File size",
              fileBytes != undefined ? formatByteSize(fileBytes) : "—",
              fileBytes != undefined && durationSeconds > 0
                ? `${(((fileBytes / durationSeconds) * 3600) / 1e9).toFixed(2)} GB/h · ${(fileBytes / durationSeconds / 1e6).toFixed(2)} MB/s`
                : "Indexed MCAP sources",
            ],
          ].map(([label, value, detail]) => (
            <div className={classes.metric} key={label}>
              <Typography
                variant="overline"
                sx={{
                  color: "text.secondary",
                }}
              >
                {label}
              </Typography>
              <Typography variant="h6">{value}</Typography>
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                }}
              >
                {detail}
              </Typography>
            </div>
          ))}
        </div>
        {!isRecording && (
          <Alert severity="info">
            Live source: counts are observed messages. Recording scans and seeking are unavailable.
          </Alert>
        )}
        {error && (
          <Alert
            severity="error"
            onClose={() => {
              setError(undefined);
            }}
          >
            {error} Completed topics are retained; retry the scan to try again.
          </Alert>
        )}
        {scanning && (
          <div className={classes.progress}>
            <LinearProgress />
            <div className={classes.heading}>
              <Typography variant="caption" role="status">
                Scanning {scanning} · {progress}
              </Typography>
              <Button size="small" onClick={() => controller.current?.abort()}>
                Cancel scan
              </Button>
            </div>
          </div>
        )}
        <section className={classes.overview} aria-label="Recording activity">
          <div className={classes.chartHeading}>
            <button
              type="button"
              className={classes.chartTitle}
              aria-expanded={showActivity}
              onClick={() => {
                setShowActivity(!showActivity);
              }}
            >
              {showActivity ? (
                <KeyboardArrowDownIcon fontSize="small" />
              ) : (
                <KeyboardArrowRightIcon fontSize="small" />
              )}
              Message activity
            </button>
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
              }}
            >
              {inspections.size > 0
                ? `${measuredCount.toLocaleString()} measured messages · ${inspections.size}/${topics.length} topics`
                : "Summary loaded · scan to inspect activity"}
            </Typography>
          </div>
          {showActivity && (
            <>
              {inspections.size > 0 ? (
                <ActivityChart
                  label="Recording"
                  buckets={aggregate}
                  start={start}
                  end={end}
                  variant="overview"
                  onSeek={seek ? seekTo : undefined}
                />
              ) : (
                <div className={classes.emptyChart}>
                  Scan a topic or the full recording to reveal its activity
                </div>
              )}
            </>
          )}
        </section>
        <Tabs
          className={classes.tabs}
          value={tab}
          onChange={(_event, value: string) => {
            setTab(value);
          }}
          aria-label="Recording information"
          variant="scrollable"
        >
          <Tab value="topics" label="Topics & timing" />
          <Tab value="files" label="File" />
          <Tab value="channels" label={`Channels (${channelCount})`} />
          <Tab value="schemas" label={`Schemas (${schemas.length})`} />
          <Tab value="metadata" label={`Metadata (${metadata.length})`} />
        </Tabs>
        {tab === "topics" && (
          <>
            <div className={classes.controls}>
              <TextField
                className={classes.search}
                size="small"
                placeholder="Search topics or schemas…"
                slotProps={{
                  htmlInput: { "aria-label": "Search topics or schemas" },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  },
                }}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
              <div className={classes.actions}>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={tree ? "tree" : "flat"}
                  onChange={(_event, value: string | null) => {
                    if (value) {
                      setTree(value === "tree");
                    }
                  }}
                  aria-label="Topic view"
                >
                  <ToggleButton value="flat">List</ToggleButton>
                  <ToggleButton value="tree">Tree</ToggleButton>
                </ToggleButtonGroup>
                <TextField
                  select
                  size="small"
                  value={sort}
                  slotProps={{ select: { SelectDisplayProps: { "aria-label": "Sort by" } } }}
                  onChange={(event) => {
                    setSort(event.target.value as SortKey);
                    setAscending(event.target.value === "topic" || event.target.value === "schema");
                  }}
                >
                  <MenuItem value="topic">Topic name</MenuItem>
                  <MenuItem value="schema">Schema</MenuItem>
                  <MenuItem value="messages">Messages</MenuItem>
                  <MenuItem value="rate">Frequency</MenuItem>
                  <MenuItem value="median">Median frequency</MenuItem>
                  <MenuItem value="jitter">Timing jitter</MenuItem>
                  <MenuItem value="size">Size</MenuItem>
                  <MenuItem value="throughput">Bytes / second</MenuItem>
                  <MenuItem value="average">Bytes / message</MenuItem>
                  <MenuItem value="interval">Largest interval</MenuItem>
                </TextField>
                <IconButton
                  size="small"
                  aria-label="Reverse sort direction"
                  title={ascending ? "Ascending" : "Descending"}
                  onClick={() => {
                    setAscending(!ascending);
                  }}
                >
                  {ascending ? (
                    <ArrowUpwardIcon fontSize="small" />
                  ) : (
                    <ArrowDownwardIcon fontSize="small" />
                  )}
                </IconButton>
                <TextField
                  select
                  size="small"
                  slotProps={{ select: { SelectDisplayProps: { "aria-label": "Rate basis" } } }}
                  value={rateBasis}
                  onChange={(event) => {
                    setRateBasis(event.target.value);
                  }}
                >
                  <MenuItem value="recording">Recording span</MenuItem>
                  <MenuItem value="active">Active span</MenuItem>
                  <MenuItem value="median">Median interval rate</MenuItem>
                </TextField>
              </div>
            </div>
            <div className={classes.tableWrap}>
              <table className={classes.table}>
                <thead>
                  <tr>
                    <th
                      aria-sort={
                        sort === "topic" ? (ascending ? "ascending" : "descending") : "none"
                      }
                    >
                      {sortHeading("topic", "Topic / schema")}
                    </th>
                    <th
                      aria-sort={
                        sort === "messages" ? (ascending ? "ascending" : "descending") : "none"
                      }
                    >
                      {sortHeading("messages", "Messages")}
                    </th>
                    <th
                      aria-sort={
                        sort === "rate" ? (ascending ? "ascending" : "descending") : "none"
                      }
                    >
                      {sortHeading("rate", "Hz")}
                    </th>
                    <th>Activity across recording</th>
                    <th>
                      {sortHeading(
                        "size",
                        estimatedSizes || inspections.size === 0 ? "Size" : "Payload",
                      )}
                    </th>
                    <th
                      aria-sort={
                        sort === "interval" ? (ascending ? "ascending" : "descending") : "none"
                      }
                    >
                      {sortHeading("interval", "Largest interval")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    if (row.kind === "namespace") {
                      const totals = namespaceTotals(row.topics, inspections, countFor);
                      return (
                        <tr className={classes.namespace} key={`namespace:${row.path}`}>
                          <td style={{ paddingLeft: 12 + row.depth * 16 }}>
                            <button
                              aria-expanded={!collapsed.has(row.path)}
                              onClick={() => {
                                setCollapsed((previous) => {
                                  const next = new Set(previous);
                                  if (next.has(row.path)) {
                                    next.delete(row.path);
                                  } else {
                                    next.add(row.path);
                                  }
                                  return next;
                                });
                              }}
                            >
                              {collapsed.has(row.path) ? (
                                <KeyboardArrowRightIcon fontSize="small" />
                              ) : (
                                <KeyboardArrowDownIcon fontSize="small" />
                              )}
                              <span>{row.path}</span>{" "}
                              <Typography
                                variant="caption"
                                sx={{
                                  color: "text.secondary",
                                }}
                              >
                                {row.count} {row.count === 1 ? "topic" : "topics"}
                              </Typography>
                            </button>
                          </td>
                          <td className={classes.numeric}>
                            {totals.count?.toLocaleString() ?? "—"}
                          </td>
                          <td
                            className={classes.numeric}
                            title="Combined message rate over the full recording span"
                          >
                            {totals.count != undefined && durationSeconds > 0
                              ? `${(totals.count / durationSeconds).toFixed(2)} Hz`
                              : "—"}
                          </td>
                          <td>
                            {totals.scanned > 0 ? (
                              <ActivityChart
                                buckets={totals.buckets}
                                start={start}
                                end={end}
                                onSeek={seek ? seekTo : undefined}
                                label={`${row.path} (scanned topics)`}
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className={classes.numeric}>
                            {totals.scanned > 0 ? (
                              <>
                                {totals.estimatedBytes ? "≈ " : ""}
                                {formatByteSize(totals.bytes)}
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: "text.secondary",
                                    display: "block",
                                  }}
                                >
                                  {totals.complete && durationSeconds > 0
                                    ? `${(((totals.bytes / durationSeconds) * 3600) / 1e9).toFixed(3)} GB/h`
                                    : `${totals.scanned}/${row.count} topics scanned`}
                                </Typography>
                              </>
                            ) : (
                              "Scan to measure"
                            )}
                          </td>
                          <td>—</td>
                        </tr>
                      );
                    }
                    const topic = row.topic;
                    const data = inspections.get(topic.name);
                    const count = countFor(topic);
                    const rate = rateFor(topic);
                    const channels = files.flatMap((file, fileIndex) =>
                      file.channels
                        .filter(
                          (channel) => channel.topic === (topic.aliasedFromName ?? topic.name),
                        )
                        .map((channel) => ({ ...channel, fileIndex })),
                    );
                    return (
                      <Fragment key={topic.name}>
                        <tr data-selected={selected === topic.name}>
                          <td
                            className={classes.topic}
                            style={{ paddingLeft: 12 + row.depth * 16 }}
                          >
                            <div>
                              <button
                                className={classes.topicButton}
                                onClick={() => {
                                  setSelected(selected === topic.name ? undefined : topic.name);
                                }}
                                aria-expanded={selected === topic.name}
                              >
                                {topic.name}
                              </button>
                              <CopyButton
                                size="small"
                                iconSize="small"
                                getText={() => topic.name}
                              />
                            </div>
                            <span className={classes.schemaLabel}>
                              {topic.schemaName ?? "No schema"}
                              {channels.length > 0
                                ? ` · ${[...new Set(channels.map((channel) => channel.messageEncoding))].join(", ")}`
                                : ""}
                            </span>
                            {topic.aliasedFromName && (
                              <span className={classes.schemaLabel}>
                                from {topic.aliasedFromName}
                              </span>
                            )}
                          </td>
                          <td className={cx(classes.numeric, classes.count)}>
                            {count?.toLocaleString() ?? "—"}
                            {count != undefined && total > 0 && (
                              <div
                                className={classes.share}
                                title={`${((100 * count) / total).toFixed(1)}% of all messages`}
                              >
                                <div style={{ width: `${(100 * count) / total}%` }} />
                              </div>
                            )}
                          </td>
                          <td
                            className={cx(classes.numeric, classes.rate)}
                            title={
                              rateBasis === "median"
                                ? "Median of positive inter-message interval frequencies; ≈ marks a sampled estimate"
                                : rateBasis === "active"
                                  ? "(count − 1) / (last − first)"
                                  : "count / full recording duration"
                            }
                          >
                            {rate != undefined
                              ? `${rateBasis === "median" && data?.timing?.medianEstimated === true ? "≈ " : ""}${rate.toFixed(2)} Hz`
                              : "—"}
                            {rateBasis !== "median" && data?.timing?.medianHz != undefined && (
                              <Typography
                                variant="caption"
                                sx={{
                                  color: "text.secondary",
                                  display: "block",
                                }}
                              >
                                {data.timing.medianEstimated ? "≈ " : ""}
                                {data.timing.medianHz.toFixed(2)} Hz median
                              </Typography>
                            )}
                          </td>
                          <td>
                            {data ? (
                              <ActivityChart
                                buckets={data.buckets}
                                start={start}
                                end={end}
                                label={topic.name}
                                onSeek={seek ? seekTo : undefined}
                              />
                            ) : (
                              <div className={classes.unknown}>Scan to reveal activity</div>
                            )}
                          </td>
                          <td
                            className={cx(classes.numeric, classes.size)}
                            title={
                              data?.estimatedBytes === true
                                ? "Estimated decoded message memory; serialized size unavailable"
                                : "Exact uncompressed serialized message payload"
                            }
                          >
                            {data
                              ? `${data.estimatedBytes ? "≈ " : ""}${formatByteSize(data.bytes)}`
                              : "—"}
                            {data && (
                              <span className={classes.schemaLabel}>
                                {sort === "average" && data.count > 0
                                  ? `${formatByteSize(data.bytes / data.count)}/msg`
                                  : durationSeconds > 0
                                    ? `${formatByteSize(data.bytes / durationSeconds)}/s`
                                    : "—"}
                              </span>
                            )}
                          </td>
                          <td>
                            {data?.largestInterval ? (
                              <button
                                className={classes.interval}
                                disabled={!seek}
                                title="Seek to the beginning of this interval; this does not imply lost messages"
                                onClick={() => {
                                  seekTo(data.largestInterval!.start);
                                }}
                              >
                                {(Number(data.largestInterval.nanoseconds) / 1e9).toFixed(3)} s
                              </button>
                            ) : (
                              "—"
                            )}
                            {data?.timing && (
                              <Typography
                                variant="caption"
                                sx={{
                                  color: "text.secondary",
                                  display: "block",
                                }}
                              >
                                {(data.timing.jitterNs / 1e6).toFixed(3)} ms jitter
                              </Typography>
                            )}
                          </td>
                        </tr>
                        {selected === topic.name && (
                          <tr>
                            <td colSpan={6}>
                              <div className={classes.heading}>
                                <div>
                                  <Typography variant="subtitle2">{topic.name}</Typography>
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      color: "text.secondary",
                                    }}
                                  >
                                    Topic details · times relative to recording start
                                  </Typography>
                                </div>
                                <div className={classes.actions}>
                                  {!data && (
                                    <Button
                                      size="small"
                                      disabled={!isRecording || scanning != undefined}
                                      onClick={() => void scan([topic.name])}
                                    >
                                      Scan this topic
                                    </Button>
                                  )}
                                  <Button
                                    size="small"
                                    onClick={() => {
                                      setSelected(undefined);
                                    }}
                                  >
                                    Close details
                                  </Button>
                                </div>
                              </div>
                              {data && (
                                <div className={classes.detailMetrics}>
                                  {[
                                    [
                                      "First message",
                                      data.first ? `+${offset(data.first, start)}` : "none",
                                    ],
                                    [
                                      "Last message",
                                      data.last ? `+${offset(data.last, start)}` : "none",
                                    ],
                                    [
                                      "Average message",
                                      data.count > 0
                                        ? `${data.estimatedBytes ? "≈ " : ""}${formatByteSize(data.bytes / data.count)}`
                                        : "—",
                                    ],
                                    [
                                      "Storage rate",
                                      durationSeconds > 0
                                        ? `${data.estimatedBytes ? "≈ " : ""}${(((data.bytes / durationSeconds) * 3600) / 1e9).toFixed(3)} GB/h`
                                        : "—",
                                    ],
                                    [
                                      "Median frequency",
                                      data.timing?.medianHz != undefined
                                        ? `${data.timing.medianEstimated ? "≈ " : ""}${data.timing.medianHz.toFixed(2)} Hz`
                                        : "—",
                                    ],
                                    [
                                      "Frequency range",
                                      data.timing?.minimumHz != undefined &&
                                      data.timing.maximumHz != undefined
                                        ? `${data.timing.minimumHz.toFixed(2)}–${data.timing.maximumHz.toFixed(2)} Hz`
                                        : "—",
                                    ],
                                    [
                                      "Timing jitter (σ)",
                                      data.timing
                                        ? `${(data.timing.jitterNs / 1e6).toFixed(3)} ms`
                                        : "—",
                                    ],
                                    [
                                      "Duplicate timestamps",
                                      data.timing?.duplicateTimestamps.toLocaleString() ?? "—",
                                    ],
                                  ].map(([label, value]) => (
                                    <div key={label}>
                                      <Typography
                                        variant="caption"
                                        sx={{
                                          color: "text.secondary",
                                        }}
                                      >
                                        {label}
                                      </Typography>
                                      <Typography variant="h6">{value}</Typography>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {topic.schemaName && (
                                <SchemaFields schemaName={topic.schemaName} datatypes={datatypes} />
                              )}
                              {channels.map((channel) => (
                                <details
                                  className={classes.details}
                                  key={`${channel.fileIndex}:${channel.id}`}
                                >
                                  <summary>
                                    Channel {channel.id} · {channel.messageEncoding} /{" "}
                                    {channel.schemaEncoding ?? "no schema"}
                                    {files.length > 1 ? ` · file ${channel.fileIndex + 1}` : ""}
                                  </summary>
                                  <KeyValueTable values={channel.metadata} />
                                </details>
                              ))}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && (
              <Typography
                sx={{
                  padding: 2,
                  color: "text.secondary",
                }}
              >
                No topics match your search.
              </Typography>
            )}
            <div className={classes.footer}>
              <span>
                {filtered.length} of {topics.length} topics
              </span>
              <Tooltip
                title={`Each activity bar covers ${durationSeconds > 0 ? (durationSeconds / BUCKET_COUNT).toFixed(2) : "0"} seconds. Largest interval is the time between consecutive messages. Timing jitter is the population standard deviation of all intervals, including duplicate timestamps. Frequency range and median exclude zero intervals. Median uses up to 8,192 sampled intervals; ≈ marks sampled medians or estimated sizes. Namespace totals cover matching descendants; namespace Hz uses the full recording span.`}
              >
                <span tabIndex={0}>About these metrics ⓘ</span>
              </Tooltip>
            </div>
          </>
        )}
        {tab === "files" && <ContainerDetails files={files} />}
        {tab === "channels" && (
          <>
            <div className={classes.controls}>
              <TextField
                size="small"
                className={classes.search}
                label="Filter channels"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </div>
            {files.flatMap((file, fileIndex) =>
              file.channels
                .filter((channel) =>
                  `${channel.id} ${channel.topic} ${channel.schemaName ?? ""} ${channel.messageEncoding}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((channel) => (
                  <details className={classes.details} key={`${fileIndex}:${channel.id}`}>
                    <summary>
                      {channel.topic}{" "}
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                        }}
                      >
                        {" "}
                        · channel {channel.id}
                        {files.length > 1 ? ` · file ${fileIndex + 1}` : ""} ·{" "}
                        {channel.messageEncoding}
                      </Typography>
                    </summary>
                    <KeyValueTable
                      values={{
                        Schema: channel.schemaName ?? "None",
                        "Schema encoding": channel.schemaEncoding ?? "None",
                        "Message encoding": channel.messageEncoding,
                      }}
                    />
                    {Object.keys(channel.metadata).length > 0 && (
                      <>
                        <Typography
                          variant="caption"
                          sx={{
                            color: "text.secondary",
                          }}
                        >
                          Channel metadata
                        </Typography>
                        <KeyValueTable values={channel.metadata} />
                      </>
                    )}
                  </details>
                )),
            )}
            {channelCount === 0 && (
              <Typography
                sx={{
                  paddingY: 2,
                  color: "text.secondary",
                }}
              >
                Channel details are available for indexed MCAP files.
              </Typography>
            )}
          </>
        )}
        {tab === "schemas" && (
          <Stack gap={1} paddingY={2}>
            {schemas.map((schema) => (
              <details className={classes.details} key={schema}>
                <summary>
                  {schema}{" "}
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                    }}
                  >
                    {" "}
                    · {datatypes.get(schema)?.definitions.length ?? "—"} fields
                  </Typography>
                </summary>
                <SchemaFields schemaName={schema} datatypes={datatypes} />
              </details>
            ))}
            {schemas.length === 0 && <Typography>No schemas available.</Typography>}
          </Stack>
        )}
        {tab === "metadata" && (
          <Stack gap={1} paddingY={2}>
            {metadata.map((entry, index) => (
              <section className={classes.details} key={index}>
                <div className={classes.chartHeading}>
                  <Typography variant="subtitle2">{entry.name}</Typography>
                  <Chip
                    label={`${Object.keys(entry.metadata).length} properties`}
                    size="small"
                    variant="outlined"
                  />
                </div>
                <KeyValueTable values={entry.metadata} />
              </section>
            ))}
            {metadata.length === 0 && (
              <Typography
                sx={{
                  color: "text.secondary",
                }}
              >
                No recording metadata available.
              </Typography>
            )}
          </Stack>
        )}
      </div>
    </>
  );
}

function SourceInfo(): React.JSX.Element {
  const playerId = useMessagePipeline(selectPlayerId);
  return <RecordingInspector key={playerId} />;
}
SourceInfo.panelType = "SourceInfo";
SourceInfo.defaultConfig = {};
export default Panel(SourceInfo);
