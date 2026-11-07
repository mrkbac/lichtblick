// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { compare, subtract, Time, toMillis } from "@foxglove/rostime";
import { TempBuffer } from "@mcap/core";
import { Button, LinearProgress, Skeleton, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { formatByteSize } from "@lichtblick/den/format";
import { Immutable } from "@lichtblick/suite";
import CopyButton from "@lichtblick/suite-base/components/CopyButton";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Stack from "@lichtblick/suite-base/components/Stack";
import TextMiddleTruncate from "@lichtblick/suite-base/components/TextMiddleTruncate";
import Timestamp from "@lichtblick/suite-base/components/Timestamp";
import { useAppTimeFormat } from "@lichtblick/suite-base/hooks";
import { PlayerPresence, RecordingFileInfo } from "@lichtblick/suite-base/players/types";
import { downloadFiles } from "@lichtblick/suite-base/util/download";
import { formatDuration, formatHms } from "@lichtblick/suite-base/util/formatTime";
import { formatTimeAgo } from "@lichtblick/suite-base/util/recentSources";
import { formatTimeRaw, isAbsoluteTime } from "@lichtblick/suite-base/util/time";
import { customTypography } from "@lichtblick/theme";

import { MultilineMiddleTruncate } from "./MultilineMiddleTruncate";

const useStyles = makeStyles<void, "copyButton">()((theme, _params, classes) => ({
  label: {
    opacity: 0.6,
  },
  numeric: {
    fontFeatureSettings: `${customTypography.fontFeatureSettings}, "zero"`,
  },
  field: {
    [`&:hover .${classes.copyButton}, & .${classes.copyButton}:focus-visible`]: {
      opacity: 1,
    },
  },
  copyButton: {
    opacity: 0,
    padding: 0,
  },
  progress: {
    marginTop: theme.spacing(0.5),
  },
  secondary: {
    color: theme.palette.text.secondary,
  },
}));

const selectPlayerName = (ctx: MessagePipelineContext) => ctx.playerState.name;
const selectPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectIsLive = (ctx: MessagePipelineContext) => ctx.seekPlayback == undefined;
const selectTopics = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.topics;
const selectTopicStats = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.topicStats;
const selectLiveStats = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.liveStats;
const selectTotalBytes = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.totalBytesReceived;
const selectExportLiveHistory = (ctx: MessagePipelineContext) => ctx.exportLiveHistory;
const selectRecordingFiles = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.recordingFiles;

const RELATIVE_TIME_REFRESH_MS = 10_000;

/** Wall-clock time that re-renders the caller every `intervalMs`. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

function EmptyValue(): React.JSX.Element {
  const { classes } = useStyles();
  return (
    <Typography className={classes.numeric} variant="inherit">
      &mdash;
    </Typography>
  );
}

/** A labelled value. Hovering it reveals a copy button when `copyText` is set. */
function Field(props: {
  label: string;
  copyText?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { label, copyText, children } = props;
  const { t } = useTranslation("dataSourceInfo");
  const { classes } = useStyles();
  return (
    <Stack className={classes.field}>
      <Typography className={classes.label} variant="overline">
        {label}
      </Typography>
      <Stack direction="row" alignItems="flex-start" gap={0.5}>
        <Stack flex="auto" overflow="hidden">
          {children}
        </Stack>
        {copyText != undefined && (
          <CopyButton
            className={classes.copyButton}
            size="small"
            iconSize="small"
            color="inherit"
            aria-label={t("copyValue", { label })}
            getText={() => copyText}
          />
        )}
      </Stack>
    </Stack>
  );
}

function SourceField(): React.JSX.Element {
  const { t } = useTranslation("dataSourceInfo");
  const playerName = useMessagePipeline(selectPlayerName);
  const presence = useMessagePipeline(selectPresence);

  let value: React.ReactNode;
  if (presence === PlayerPresence.INITIALIZING) {
    value = <Skeleton animation="wave" width="40%" />;
  } else if (presence === PlayerPresence.RECONNECTING) {
    value = t("waitingForConnection");
  } else if (playerName) {
    value = <MultilineMiddleTruncate text={playerName} />;
  } else {
    value = <EmptyValue />;
  }
  return (
    <Field label={t("currentSource")} copyText={playerName === "" ? undefined : playerName}>
      <Typography variant="inherit" component="div">
        {value}
      </Typography>
    </Field>
  );
}

function StartTimeField({ startTime }: { startTime?: Time }): React.JSX.Element {
  const { t, i18n } = useTranslation("dataSourceInfo");
  const { classes } = useStyles();
  const now = useNow(RELATIVE_TIME_REFRESH_MS);

  return (
    <Field label={t("startTime")} copyText={startTime && formatTimeRaw(startTime)}>
      {startTime ? (
        <>
          <Timestamp horizontal time={startTime} />
          {isAbsoluteTime(startTime) && (
            <Typography className={classes.secondary} variant="inherit">
              {formatTimeAgo(toMillis(startTime), now, i18n.language)}
            </Typography>
          )}
        </>
      ) : (
        <EmptyValue />
      )}
    </Field>
  );
}

function EndTimeAndDurationFields(props: { startTime?: Time; isLive: boolean }): React.JSX.Element {
  const { startTime, isLive } = props;
  const { t } = useTranslation("dataSourceInfo");
  const { classes } = useStyles();
  const endTime = useMessagePipeline(selectEndTime);
  const duration = startTime && endTime ? subtract(endTime, startTime) : undefined;

  return (
    <>
      {!isLive && (
        <Field label={t("endTime")} copyText={endTime && formatTimeRaw(endTime)}>
          {endTime ? <Timestamp horizontal time={endTime} /> : <EmptyValue />}
        </Field>
      )}
      <Field label={t("duration")} copyText={duration && formatTimeRaw(duration)}>
        {duration ? (
          <Typography className={classes.numeric} variant="inherit">
            {formatDuration(duration)}
          </Typography>
        ) : (
          <EmptyValue />
        )}
      </Field>
    </>
  );
}

function ContentsFields(): React.JSX.Element {
  const { t, i18n } = useTranslation("dataSourceInfo");
  const { classes } = useStyles();
  const topics = useMessagePipeline(selectTopics);
  const topicStats = useMessagePipeline(selectTopicStats);

  const counts = useMemo(() => {
    let messages = 0;
    for (const stats of topicStats?.values() ?? []) {
      messages += stats.numMessages;
    }
    return [
      { label: t("topics"), value: topics?.length },
      { label: t("messages"), value: topicStats && topicStats.size > 0 ? messages : undefined },
      {
        label: t("schemas"),
        value: topics && new Set(topics.flatMap((topic) => topic.schemaName ?? [])).size,
      },
    ];
  }, [t, topics, topicStats]);

  return (
    <Stack direction="row" gap={2}>
      {counts.map(({ label, value }) => (
        <Field key={label} label={label}>
          <Typography className={classes.numeric} variant="inherit">
            {value == undefined ? "—" : value.toLocaleString(i18n.language)}
          </Typography>
        </Field>
      ))}
    </Stack>
  );
}

function FileRow(props: {
  file: Immutable<RecordingFileInfo>;
  recordingStart?: Time;
}): React.JSX.Element {
  const { file, recordingStart } = props;
  const { classes, cx } = useStyles();
  const { formatDate, formatTime } = useAppTimeFormat();

  // Offsets from the recording start make gaps and overlaps between files easy to spot.
  const range =
    recordingStart && file.start && file.end
      ? `+${formatDuration(subtract(file.start, recordingStart))} – +${formatDuration(subtract(file.end, recordingStart))}`
      : undefined;
  const absoluteRange =
    file.start && file.end && isAbsoluteTime(file.start)
      ? `${formatDate(file.start)} ${formatTime(file.start)} – ${formatDate(file.end)} ${formatTime(file.end)}`
      : undefined;
  const details = [range, file.sizeBytes != undefined ? formatByteSize(file.sizeBytes) : undefined]
    .filter(Boolean)
    .join(" · ");

  return (
    <Stack title={absoluteRange}>
      <Typography variant="inherit" component="div">
        <TextMiddleTruncate text={file.name ?? file.library} />
      </Typography>
      {details && (
        <Typography className={cx(classes.numeric, classes.secondary)} variant="inherit">
          {details}
        </Typography>
      )}
    </Stack>
  );
}

function FilesField({ startTime }: { startTime?: Time }): React.JSX.Element | null {
  const { t } = useTranslation("dataSourceInfo");
  const files = useMessagePipeline(selectRecordingFiles);

  const sortedFiles = useMemo(
    () => files && [...files].sort((a, b) => (a.start && b.start ? compare(a.start, b.start) : 0)),
    [files],
  );

  if (!sortedFiles || sortedFiles.length === 0) {
    return null;
  }
  // With a single file the range would only repeat start, end and duration.
  const recordingStart = sortedFiles.length > 1 ? startTime : undefined;
  return (
    <Field label={t("files")}>
      <Stack gap={0.75}>
        {sortedFiles.map((file, index) => (
          <FileRow key={`${file.name}-${index}`} file={file} recordingStart={recordingStart} />
        ))}
      </Stack>
    </Field>
  );
}

/** "live-2026-11-07T10-30-00.mcap" */
function liveHistoryFileName(now: Date): string {
  return `live-${now.toISOString().slice(0, 19).replace(/:/g, "-")}.mcap`;
}

/** Live sources with a rolling history: session totals, history fill and saving it to MCAP. */
function LiveFields(): React.JSX.Element | null {
  const { t, i18n } = useTranslation("dataSourceInfo");
  const { classes } = useStyles();
  const stats = useMessagePipeline(selectLiveStats);
  const totalBytes = useMessagePipeline(selectTotalBytes) ?? 0;
  const exportLiveHistory = useMessagePipeline(selectExportLiveHistory);
  const now = useNow(1000);
  const [saveState, setSaveState] = useState<
    { status: "saving" } | { status: "saved" } | { status: "failed"; error: string } | undefined
  >();

  if (!stats) {
    return null;
  }

  const connectedMs = stats.connectedAtMs == undefined ? 0 : now - stats.connectedAtMs;
  // Called straight from the click: the player snapshots the history before its first await, so
  // what is in the history at the click is what gets saved.
  const save = async () => {
    if (!exportLiveHistory) {
      return;
    }
    const fileName = liveHistoryFileName(new Date());
    setSaveState({ status: "saving" });
    try {
      // ponytail: whole file built in memory, bounded by the history memory limit.
      const file = new TempBuffer();
      await exportLiveHistory(file);
      downloadFiles([{ blob: new Blob([file.get().slice()]), fileName }]);
      setSaveState({ status: "saved" });
    } catch (err) {
      setSaveState({ status: "failed", error: String(err) });
    }
  };

  return (
    <>
      {stats.connectedAtMs != undefined && (
        <Field label={t("session")}>
          <Typography className={classes.numeric} variant="inherit">
            {t("sessionValue", {
              duration: formatHms(connectedMs, { withMillis: false }),
              size: formatByteSize(totalBytes),
              rate: formatByteSize(connectedMs > 0 ? (totalBytes * 1000) / connectedMs : 0),
            })}
          </Typography>
        </Field>
      )}
      <Field label={t("history")}>
        <Typography className={classes.numeric} variant="inherit">
          {t("historyValue", {
            messages: stats.historyMessages.toLocaleString(i18n.language),
            size: formatByteSize(stats.historyBytes),
            limit: formatByteSize(stats.historyLimitBytes),
          })}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={Math.min(100, (100 * stats.historyBytes) / Math.max(1, stats.historyLimitBytes))}
          className={classes.progress}
        />
      </Field>
      {exportLiveHistory && (
        <Stack direction="row" alignItems="center" gap={1}>
          <Button
            size="small"
            variant="outlined"
            disabled={saveState?.status === "saving" || stats.historyMessages === 0}
            title={t("saveHistoryTitle")}
            onClick={() => void save()}
          >
            {saveState?.status === "saving" ? t("savingHistory") : t("saveHistory")}
          </Button>
          {saveState?.status === "saved" && (
            <Typography className={classes.secondary} variant="inherit">
              {t("savedHistory")}
            </Typography>
          )}
          {saveState?.status === "failed" && (
            <Typography color="error" variant="inherit">
              {t("saveHistoryFailed", { error: saveState.error })}
            </Typography>
          )}
        </Stack>
      )}
    </>
  );
}

/**
 * Summary of the open data source: name, time range, contents and files. Values can be copied
 * from a hover button; times are copied as raw `sec.nsec`.
 */
export function DataSourceInfoView({
  disableSource = false,
}: {
  disableSource?: boolean;
}): React.JSX.Element {
  const presence = useMessagePipeline(selectPresence);
  const startTime = useMessagePipeline(selectStartTime);
  const isLive = useMessagePipeline(selectIsLive);

  if (presence === PlayerPresence.INITIALIZING) {
    return (
      <Stack gap={1.5}>
        {!disableSource && <SourceField />}
        <Skeleton animation="wave" width="60%" />
        <Skeleton animation="wave" width="60%" />
        <Skeleton animation="wave" width={100} />
      </Stack>
    );
  }

  return (
    <Stack gap={1.5}>
      {!disableSource && <SourceField />}
      <StartTimeField startTime={startTime} />
      <EndTimeAndDurationFields startTime={startTime} isLive={isLive} />
      <ContentsFields />
      <LiveFields />
      <FilesField startTime={startTime} />
    </Stack>
  );
}
