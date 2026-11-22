// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Topic Message Navigation Hook
 *
 * PERFORMANCE OPTIMIZATION NOTES:
 *
 * 1. MCAP Footer Loading (Remote & Local Files)
 *    - MCAP files load the footer FIRST, even for remote connections via HTTP range requests
 *    - The footer contains the summary section with ChunkIndexes that include messageStartTime/messageEndTime
 *    - This means topicStats.firstMessageTime and topicStats.lastMessageTime are available IMMEDIATELY
 *      after initialization, without needing to iterate through all messages
 *    - See: @lichtblick/mcap-core McapIndexedReader.Initialize() - reads footer from end of file before chunk data
 *
 * 2. Navigation Optimization Strategy
 *    - All time-only reads use the payload-free inspection iterator when the player has one
 *    - Next message: Direct seek from currentTime; stops at the first message after it once the
 *      topic's last message time is known
 *    - Previous message: getMessageAtTime (indexed backward lookup) gives a candidate, then the
 *      range between it and the current time is read to confirm nothing newer exists. Backfill is
 *      approximate for some sources (overlapping files, unindexed reads, converters), so it is only
 *      ever a lower bound. Without a candidate, backward windows grow geometrically from the
 *      current time, so the read is proportional to the distance, never the whole prefix.
 *
 * 3. Boundaries Cache
 *    - Per-topic first/last times come from topicStats when the source reports them
 *    - Otherwise only the first message is read, and the last one is looked up backwards from
 *      the end time the same way as "previous message"; the topic is never read in full
 */

import { Time, add as addTime, compare, subtract as subtractTime } from "@foxglove/rostime";
import { enableMapSet } from "immer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useImmer } from "use-immer";

import Logger from "@lichtblick/log";
import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
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
import { RESULT_TYPE_MESSAGE_EVENT } from "@lichtblick/suite-base/components/TopicList/constants";
import {
  DEFAULT_WINDOW_MS,
  WINDOW_GROWTH_FACTOR,
  calculateOptimalWindowMs,
  subtractMilliseconds,
} from "@lichtblick/suite-base/components/TopicList/timeWindowHelpers";
import {
  TopicBoundaries,
  UseTopicMessageNavigationReturn,
} from "@lichtblick/suite-base/components/TopicList/types";

const log = Logger.getLogger(__filename);

const logNavigationError = (direction: "next" | "previous", error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  log.warn(`Error navigating to ${direction} message: ${message}`);
};

const selectNothing = () => undefined;

const ZERO_TIME: Time = Object.freeze({ sec: 0, nsec: 0 });

const sameTime = (a: Time | undefined, b: Time | undefined): boolean =>
  a == undefined || b == undefined ? a === b : compare(a, b) === 0;
const ONE_NANOSECOND: Time = Object.freeze({ sec: 0, nsec: 1 });
// First fallback window holds about this many messages: big windows read more chunks than they
// save in round trips (measured on indexed MCAP).
const WINDOW_TARGET_MESSAGES = 2;

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
  const [boundariesCache, setBoundariesCache] = useImmer(() => new Map<string, TopicBoundaries>());
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

  // Navigation only needs receive times. The inspection iterator skips decoding payloads (a
  // camera frame costs nothing to step over); sources without it get decoded batches.
  const iterateTimes = useCallback(
    (topic: string, options?: { start?: Time; end?: Time }) =>
      getInspectionIterator?.([topic], options) ?? getBatchIterator(topic, options),
    [getInspectionIterator, getBatchIterator],
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
      setBoundariesCache((draft) => {
        const existing = draft.get(topic) ?? {};
        draft.set(topic, { ...existing, ...updates });
      });
    },
    [setBoundariesCache],
  );

  // Receive time of the last message on `topic` in [start, end], or undefined if there is none.
  // `aborted` is true when the read stopped early, either cancelled or because the source can't
  // iterate the topic.
  const lastMessageIn = useCallback(
    async (
      signal: AbortSignal,
      topic: string,
      start: Time,
      end: Time,
    ): Promise<{ found?: Time; aborted: boolean }> => {
      const iterator = iterateTimes(topic, { start, end });
      if (!iterator) {
        return { aborted: true };
      }
      let found: Time | undefined;
      for await (const result of iterator) {
        if (signal.aborted) {
          return { aborted: true };
        }
        if (result.type !== RESULT_TYPE_MESSAGE_EVENT) {
          continue;
        }
        if (compare(result.msgEvent.receiveTime, end) > 0) {
          break;
        }
        found = result.msgEvent.receiveTime;
      }
      return { found, aborted: signal.aborted };
    },
    [iterateTimes],
  );

  // Receive time of the latest message on `topic` at or before `time`, never earlier than `floor`.
  const findMessageAtOrBefore = useCallback(
    async (
      signal: AbortSignal,
      topic: string,
      time: Time,
      floor: Time = ZERO_TIME,
      initialWindowMs: number = DEFAULT_WINDOW_MS,
    ): Promise<Time | undefined> => {
      // The indexed backward lookup is fast, but approximate for some sources (overlapping files,
      // unindexed reads, converters). Use it as a lower bound and read only the gap after it,
      // which picks up anything newer it missed.
      const candidate = (await getMessageAtTime(topic, time, signal))?.receiveTime;
      if (candidate && compare(candidate, time) <= 0) {
        const gap = await lastMessageIn(signal, topic, addTime(candidate, ONE_NANOSECOND), time);
        return gap.aborted && signal.aborted ? undefined : (gap.found ?? candidate);
      }

      // No candidate (no indexed lookup for this topic, or nothing before `time`): backward windows
      // that grow geometrically and don't overlap, so the bytes read scale with the distance to the
      // message instead of the length of the recording before it.
      let end = time;
      // Terminates: windows grow geometrically until one reaches the floor.
      for (let windowMs = initialWindowMs; ; windowMs *= WINDOW_GROWTH_FACTOR) {
        let start = subtractMilliseconds(time, windowMs);
        const reachedFloor = compare(start, floor) <= 0;
        if (reachedFloor) {
          start = floor;
        }
        const scan = await lastMessageIn(signal, topic, start, end);
        if (scan.aborted) {
          return undefined;
        }
        if (scan.found || reachedFloor) {
          return scan.found;
        }
        end = start;
      }
    },
    [getMessageAtTime, lastMessageIn],
  );

  // Read through a ref so discovery doesn't restart on every tick of a growing source, where
  // endTime and topicStats change constantly.
  const latestRef = useRef({ topicStats, endTime });
  useEffect(() => {
    latestRef.current = { topicStats, endTime };
  });
  const hasEndTime = endTime != undefined;

  const discoverBoundaries = useCallback(
    async (signal: AbortSignal, topic: string) => {
      const { topicStats: stats, endTime: end } = latestRef.current;
      const topicStatsEntry = stats?.get(topic);
      let first = topicStatsEntry?.firstMessageTime;
      let last = topicStatsEntry?.lastMessageTime;

      if (!first) {
        const iterator = iterateTimes(topic);
        if (!iterator) {
          return;
        }
        for await (const result of iterator) {
          if (signal.aborted) {
            return;
          }
          if (result.type === RESULT_TYPE_MESSAGE_EVENT) {
            first = result.msgEvent.receiveTime;
            break;
          }
        }
      }

      if (first && !last && end) {
        const windowMs = calculateOptimalWindowMs({
          numMessages: topicStatsEntry?.numMessages ?? 0,
          firstMessageTime: first,
          lastMessageTime: end,
          targetMessagesInWindow: WINDOW_TARGET_MESSAGES,
        });
        last = await findMessageAtOrBefore(signal, topic, end, first, windowMs);
      }

      // Cache complete results only; the effect retries once the end time is known. `lastAtEnd`
      // records the end this was checked against, so growth past it invalidates `last`.
      if (!signal.aborted && first && last) {
        updateBoundariesCache(topic, { first, last, lastAtEnd: end });
      }
    },
    [iterateTimes, findMessageAtOrBefore, updateBoundariesCache],
  );

  useEffect(() => {
    // Navigation may cache one end on its own; only skip once both are known.
    const cached = boundariesCache.get(topicName);
    if (!selected || !isTopicSubscribed || (cached?.first && cached.last)) {
      return;
    }

    const abortController = new AbortController();
    discoverBoundaries(abortController.signal, topicName).catch((error: unknown) => {
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
    async (
      signal: AbortSignal,
      current: Time,
    ): Promise<{ targetTime: Time; isLastMessage: boolean } | undefined> => {
      // OPTIMIZATION: Seek directly to currentTime instead of iterating from beginning
      // This is O(1) for indexed MCAP files vs O(n) for full iteration
      const iterator = iterateTimes(topicName, { start: current });
      if (!iterator) {
        return undefined;
      }

      let targetTime: Time | undefined;
      let foundMessageAfterTarget = false;

      for await (const result of iterator) {
        if (signal.aborted) {
          return undefined;
        }
        if (result.type !== RESULT_TYPE_MESSAGE_EVENT) {
          continue;
        }

        const isAfterCurrent = compare(result.msgEvent.receiveTime, current) > 0;
        if (!isAfterCurrent) {
          continue;
        }

        if (targetTime) {
          foundMessageAfterTarget = true;
          break;
        }

        targetTime = result.msgEvent.receiveTime;
        if (knownLast) {
          // The last message is known, so there is no need to read one more to find out.
          return { targetTime, isLastMessage: compare(targetTime, knownLast) >= 0 };
        }
      }

      if (!targetTime) {
        return undefined;
      }

      return { targetTime, isLastMessage: !foundMessageAfterTarget };
    },
    [iterateTimes, topicName, knownLast],
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

      // Size the first fallback window from the topic's message density (count from the
      // summary, time span from stats or the discovered boundaries).
      let initialWindowMs = DEFAULT_WINDOW_MS;

      const densityFirst = stats?.firstMessageTime ?? firstMessageTime;
      const densityLast = stats?.lastMessageTime ?? lastMessageTime;
      if (stats?.numMessages != undefined && densityFirst && densityLast) {
        initialWindowMs = calculateOptimalWindowMs({
          numMessages: stats.numMessages,
          firstMessageTime: densityFirst,
          lastMessageTime: densityLast,
          targetMessagesInWindow: WINDOW_TARGET_MESSAGES,
        });
      }

      // Per-topic first times from stats are exact: live players record the first one they see,
      // CSV requires increasing times, and merged or shifted sources keep the earliest.
      const first = firstMessageTime ?? stats?.firstMessageTime;
      const targetTime = await findMessageAtOrBefore(
        signal,
        topicName,
        subtractTime(currentTime, ONE_NANOSECOND),
        first ?? startTime,
        initialWindowMs,
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
    findMessageAtOrBefore,
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
