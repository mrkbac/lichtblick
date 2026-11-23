// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Topic Message Navigation Hook: next/previous message on one topic, and whether either is
 * possible. The reads themselves live in topicNavigationReads, loaded on first use so they stay
 * out of startup; this hook holds the state, the boundaries cache and the pipeline wiring.
 */

import { Time, compare, subtract as subtractTime } from "@foxglove/rostime";
import { enableMapSet, produce } from "immer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Logger from "@lichtblick/log";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  selectCurrentTime,
  selectEndTime,
  selectGetBatchIterator,
  selectGetMessageAtTime,
  selectInspectionIterator,
  selectPausePlayback,
  selectSeekPlayback,
  selectStartTime,
  selectTopicStats,
} from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import type { NavigationReads } from "@lichtblick/suite-base/components/TopicList/topicNavigationReads";
import {
  TopicBoundaries,
  UseTopicMessageNavigationReturn,
} from "@lichtblick/suite-base/components/TopicList/types";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";

const log = Logger.getLogger(__filename);

const logNavigationError = (direction: "next" | "previous", error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  log.warn(`Error navigating to ${direction} message: ${message}`);
};

const selectNothing = () => undefined;
const selectHasIndexedBackfill = (ctx: MessagePipelineContext): boolean =>
  ctx.playerState.capabilities.includes(PLAYER_CAPABILITIES.indexedBackfill);

const sameTime = (a: Time | undefined, b: Time | undefined): boolean =>
  a == undefined || b == undefined ? a === b : compare(a, b) === 0;
const ONE_NANOSECOND: Time = Object.freeze({ sec: 0, nsec: 1 });

// Only needed once someone navigates or selects a topic, so not part of startup
const loadReads = async () =>
  await import("@lichtblick/suite-base/components/TopicList/topicNavigationReads");

enableMapSet();

export function useTopicMessageNavigation({
  topicName,
  selected,
  isTopicSubscribed,
}: {
  topicName: string;
  selected: boolean;
  isTopicSubscribed: boolean;
}): UseTopicMessageNavigationReturn {
  const [isNavigating, setIsNavigating] = useState(false);
  const [boundariesCache, setBoundariesCache] = useState(() => new Map<string, TopicBoundaries>());
  const navigationAbortControllerRef = useRef<AbortController | undefined>(undefined);

  // Abort any in-progress navigation when the component unmounts
  useEffect(() => {
    return () => {
      navigationAbortControllerRef.current?.abort();
    };
  }, []);

  // Creates a new AbortSignal for navigation, aborting any previous in-progress navigation
  const createNavigationSignal = useCallback(() => {
    navigationAbortControllerRef.current?.abort();
    const controller = new AbortController();
    navigationAbortControllerRef.current = controller;
    return controller.signal;
  }, []);

  // Only the selected row can navigate; other rows skip these per-tick subscriptions.
  const currentTime = useMessagePipeline(selected ? selectCurrentTime : selectNothing);
  const startTime = useMessagePipeline(selected ? selectStartTime : selectNothing);
  const endTime = useMessagePipeline(selected ? selectEndTime : selectNothing);
  const topicStats = useMessagePipeline(selected ? selectTopicStats : selectNothing);
  const seekPlayback = useMessagePipeline(selectSeekPlayback);
  const pausePlayback = useMessagePipeline(selectPausePlayback);
  const getBatchIterator = useMessagePipeline(selectGetBatchIterator);
  const getInspectionIterator = useMessagePipeline(selectInspectionIterator);
  const getMessageAtTime = useMessagePipeline(selectGetMessageAtTime);
  const hasIndexedBackfill = useMessagePipeline(selectHasIndexedBackfill);

  // Navigation only needs receive times. The inspection iterator skips decoding payloads (a
  // camera frame costs nothing to step over); sources without it get decoded batches. Recorded
  // topics can be inspected; virtual ones (user-script or converter outputs) can't. Creating the
  // iterator reads nothing.
  const reads = useMemo<NavigationReads>(
    () => ({
      iterateTimes: (topic, options) =>
        getInspectionIterator?.([topic], options) ?? getBatchIterator(topic, options),
      getMessageAtTime,
      hasIndexedBackfill,
      isRecorded: (topic) => getInspectionIterator?.([topic]) != undefined,
    }),
    [getInspectionIterator, getBatchIterator, getMessageAtTime, hasIndexedBackfill],
  );

  const cachedBoundaries = boundariesCache.get(topicName);
  const firstMessageTime = cachedBoundaries?.first;
  // A cached last message is only valid for the end time it was found against: once a recording
  // grows past that end, newer messages may exist.
  const lastMessageTime =
    cachedBoundaries?.last && sameTime(cachedBoundaries.lastAtEnd, endTime)
      ? cachedBoundaries.last
      : undefined;

  // The boundaries cache avoids expensive re-iteration through all messages when
  // switching between topics. Merges partial boundary updates, preserving existing
  // values so first and last boundaries can be discovered independently
  // (e.g., handlePreviousMessage finds first, handleNextMessage finds last).
  //
  // NOTE: For MCAP files, topicStats provides accurate boundaries from the footer
  // (loaded first via HTTP range request for remote files). The cache serves as a
  // fallback for non-MCAP sources or when topicStats is temporarily unavailable.
  const updateBoundariesCache = useCallback(
    (topic: string, updates: Partial<TopicBoundaries>) => {
      setBoundariesCache(
        produce((draft) => {
          const existing = draft.get(topic) ?? {};
          const next = { ...existing, ...updates };
          // Writing equal values would still make a new state and re-run discovery
          if (
            sameTime(existing.first, next.first) &&
            sameTime(existing.last, next.last) &&
            sameTime(existing.lastAtEnd, next.lastAtEnd)
          ) {
            return;
          }
          draft.set(topic, next);
        }),
      );
    },
    [setBoundariesCache],
  );

  // Read through a ref so discovery doesn't restart on every tick of a growing source, where
  // endTime and topicStats change constantly.
  const latestRef = useRef({ topicStats, endTime });
  useEffect(() => {
    latestRef.current = { topicStats, endTime };
  });
  const hasEndTime = endTime != undefined;

  const discoverBoundaries = useCallback(
    async (signal: AbortSignal, topic: string, cachedFirst: Time | undefined) => {
      const { topicStats: stats, endTime: end } = latestRef.current;
      const { discoverTopicBoundaries } = await loadReads();
      const found = await discoverTopicBoundaries(reads, signal, topic, {
        stats: stats?.get(topic),
        first: cachedFirst,
        end,
      });
      // `lastAtEnd` records the end `last` was checked against, so growth past it invalidates
      // `last`. Without an end yet, `first` is cached alone and the effect retries for `last`
      // once the end time is known.
      if (!signal.aborted && found?.first) {
        updateBoundariesCache(
          topic,
          found.last
            ? { first: found.first, last: found.last, lastAtEnd: end }
            : { first: found.first },
        );
      }
    },
    [reads, updateBoundariesCache],
  );

  useEffect(() => {
    // Navigation may cache one end on its own; only skip once both are known.
    const cached = boundariesCache.get(topicName);
    if (!selected || !isTopicSubscribed || (cached?.first && cached.last)) {
      return;
    }

    const abortController = new AbortController();
    discoverBoundaries(abortController.signal, topicName, cached?.first).catch((error: unknown) => {
      if (!abortController.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn(`Error discovering message boundaries: ${message}`);
      }
    });

    return () => {
      abortController.abort();
    };
  }, [topicName, selected, discoverBoundaries, boundariesCache, isTopicSubscribed, hasEndTime]);

  const canNavigateNext = useMemo(() => {
    if (!currentTime) {
      return false;
    }

    const isAtPlaybackEnd = endTime != undefined && compare(currentTime, endTime) >= 0;
    // Use topicStats for per-topic boundary, fallback to cache, then to global endTime.
    // This enables navigation immediately for MCAP files (using global time) while
    // allowing more accurate per-topic boundaries to be discovered during navigation.
    const lastTopicMessageTime =
      topicStats?.get(topicName)?.lastMessageTime ?? lastMessageTime ?? endTime;

    if (!lastTopicMessageTime) {
      return false;
    }

    const isAtLastTopicMessage = compare(currentTime, lastTopicMessageTime) >= 0;

    return !isAtPlaybackEnd && !isAtLastTopicMessage;
  }, [currentTime, endTime, topicStats, topicName, lastMessageTime]);

  const canNavigatePrevious = useMemo(() => {
    if (!currentTime) {
      return false;
    }

    const isAtPlaybackStart = startTime != undefined && compare(currentTime, startTime) <= 0;
    // Use topicStats for per-topic boundary, fallback to cache, then to global startTime.
    // This enables navigation immediately for MCAP files (using global time) while
    // allowing more accurate per-topic boundaries to be discovered during navigation.
    const firstTopicMessageTime =
      topicStats?.get(topicName)?.firstMessageTime ?? firstMessageTime ?? startTime;

    if (!firstTopicMessageTime) {
      return false;
    }

    const isAtFirstTopicMessage = compare(currentTime, firstTopicMessageTime) <= 0;

    return !isAtPlaybackStart && !isAtFirstTopicMessage;
  }, [currentTime, startTime, topicStats, topicName, firstMessageTime]);

  const knownLast = topicStats?.get(topicName)?.lastMessageTime ?? lastMessageTime;
  const findNextMessage = useCallback(
    async (signal: AbortSignal, current: Time) => {
      const nav = await loadReads();
      return await nav.findNextMessage(reads, signal, topicName, current, knownLast);
    },
    [reads, topicName, knownLast],
  );

  const handleNextMessage = useCallback(async () => {
    if (isNavigating || !currentTime || !seekPlayback || !pausePlayback) {
      return;
    }

    const signal = createNavigationSignal();
    setIsNavigating(true);

    try {
      const result = await findNextMessage(signal, currentTime);

      if (signal.aborted) {
        return;
      }

      if (!result) {
        if (!lastMessageTime) {
          updateBoundariesCache(topicName, { last: currentTime, lastAtEnd: endTime });
        }
        return;
      }

      if (result.isLastMessage && !lastMessageTime) {
        updateBoundariesCache(topicName, { last: result.targetTime, lastAtEnd: endTime });
      }

      pausePlayback();
      seekPlayback(result.targetTime);
    } catch (error) {
      logNavigationError("next", error);
    } finally {
      if (!signal.aborted) {
        setIsNavigating(false);
      }
    }
  }, [
    isNavigating,
    currentTime,
    topicName,
    seekPlayback,
    pausePlayback,
    findNextMessage,
    lastMessageTime,
    endTime,
    updateBoundariesCache,
    createNavigationSignal,
  ]);

  const handlePreviousMessage = useCallback(async () => {
    if (isNavigating || !currentTime || !seekPlayback || !pausePlayback) {
      return;
    }

    const signal = createNavigationSignal();
    setIsNavigating(true);

    try {
      const stats = topicStats?.get(topicName);
      const nav = await loadReads();
      // Size the first window from the topic's message density (count from the summary, time
      // span from stats or the discovered boundaries). Per-topic first times from stats are
      // exact: live players record the first one they see, CSV requires increasing times, and
      // merged or shifted sources keep the earliest.
      const first = firstMessageTime ?? stats?.firstMessageTime;
      const targetTime = await nav.findMessageAtOrBefore(
        reads,
        signal,
        topicName,
        subtractTime(currentTime, ONE_NANOSECOND),
        first ?? startTime,
        nav.initialWindowMs(
          stats?.numMessages,
          stats?.firstMessageTime ?? firstMessageTime,
          stats?.lastMessageTime ?? lastMessageTime,
        ),
      );

      if (signal.aborted) {
        return;
      }

      if (!targetTime) {
        return;
      }

      pausePlayback();
      seekPlayback(targetTime);
    } catch (error) {
      logNavigationError("previous", error);
    } finally {
      if (!signal.aborted) {
        setIsNavigating(false);
      }
    }
  }, [
    isNavigating,
    currentTime,
    topicName,
    seekPlayback,
    pausePlayback,
    reads,
    firstMessageTime,
    lastMessageTime,
    startTime,
    topicStats,
    createNavigationSignal,
  ]);

  return {
    handleNextMessage,
    handlePreviousMessage,
    isNavigating,
    canNavigateNext,
    canNavigatePrevious,
  };
}
