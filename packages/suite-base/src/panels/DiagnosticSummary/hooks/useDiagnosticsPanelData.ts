// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromSec, toSec } from "@foxglove/rostime";
import { useCallback, useMemo } from "react";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { DEFAULT_SECONDS_UNTIL_STALE } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import { useDiagnosticHistory } from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticHistory";
import {
  DiagnosticTopics,
  DiagnosticTopicsConfig,
  useDiagnosticTopics,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticTopics";
import useDiagnostics from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnostics";
import usePlaybackTimes from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/usePlaybackTimes";
import { DiagnosticsById } from "@lichtblick/suite-base/panels/DiagnosticSummary/types";
import { getDiagnosticsWithStales } from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/getDiagnosticsWithStales";
import { HistoryById } from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/history";
import { getStaleTime } from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/util";

export type TimelineRange = { start: number; end: number; current: number | undefined };

export type DiagnosticsPanelData = {
  topics: DiagnosticTopics;
  /** Latest status per check, with STALE applied. */
  diagnostics: DiagnosticsById;
  /** Level history per check: the whole recording when available, else what was played. */
  history: HistoryById;
  /** Seconds without messages until a check is stale; 0 = never. */
  staleSec: number;
  /** Timeline extent in seconds; undefined until the data source has a time range. */
  range: TimelineRange | undefined;
  /** Seeks playback; undefined if the data source can't seek. */
  seek: ((seconds: number) => void) | undefined;
};

const selectSeekPlayback = (ctx: MessagePipelineContext) => ctx.seekPlayback;

/** Everything both diagnostics panels need, wired together once. */
export function useDiagnosticsPanelData(
  config: DiagnosticTopicsConfig & { secondsUntilStale?: number },
): DiagnosticsPanelData {
  const secondsUntilStale = config.secondsUntilStale ?? DEFAULT_SECONDS_UNTIL_STALE;
  const staleSec = secondsUntilStale >= 1 ? Math.floor(secondsUntilStale) : 0;

  const topics = useDiagnosticTopics(config);
  const { latest, history: playedHistory } = useDiagnostics(topics.subscribed, staleSec);
  const rangeHistory = useDiagnosticHistory(topics.subscribed, staleSec);
  const { start, end, current } = usePlaybackTimes();

  const staleTime = getStaleTime(current, secondsUntilStale);
  const diagnostics = useMemo(
    () => getDiagnosticsWithStales(latest, staleTime, topics.subscribed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [latest, topics.subscribed, staleTime?.sec, staleTime?.nsec],
  );

  const startSec = start ? toSec(start) : undefined;
  const endSec = end ? toSec(end) : undefined;
  const currentSec = current ? toSec(current) : undefined;
  const range = useMemo(
    () =>
      startSec != undefined && endSec != undefined && endSec > startSec
        ? { start: startSec, end: endSec, current: currentSec }
        : undefined,
    [startSec, endSec, currentSec],
  );

  const seekPlayback = useMessagePipeline(selectSeekPlayback);
  const seekSeconds = useCallback(
    (seconds: number) => {
      seekPlayback?.(fromSec(seconds));
    },
    [seekPlayback],
  );

  return {
    topics,
    diagnostics,
    history: rangeHistory ?? playedHistory,
    staleSec,
    range,
    seek: seekPlayback ? seekSeconds : undefined,
  };
}
