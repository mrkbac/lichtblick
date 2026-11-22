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
 *    - Previous message: getMessageAtTime (indexed backward lookup). Sources without one get
 *      backward windows that grow geometrically, sized from topic density when known, so the
 *      read is proportional to the distance to the previous message, never the whole prefix.
 *
 * 3. Boundaries Cache
 *    - Per-topic first/last times come from topicStats when the source reports them
 *    - Otherwise only the first message is read, and the last one is looked up backwards from
 *      the end time the same way as "previous message"; the topic is never read in full
 */

import { Time, compare, subtract as subtractTime } from "@foxglove/rostime";
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
const ONE_NANOSECOND: Time = Object.freeze({ sec: 0, nsec: 1 });

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
  const getMessageAtTime = useMessagePipeline(selectGetMessageAtTime);
  const getInspectionIterator = useMessagePipeline(selectInspectionIterator);

  // Navigation only needs receive times. The inspection iterator skips decoding payloads (a
  // camera frame costs nothing to step over); sources without it get decoded batches.
  const iterateTimes = useCallback(
    (topic: string, options?: { start?: Time; end?: Time }) =>
      getInspectionIterator?.([topic], options) ?? getBatchIterator(topic, options),
    [getInspectionIterator, getBatchIterator],
  );

  const cachedBoundaries = boundariesCache.get(topicName);
  const firstMessageTime = cachedBoundaries?.first;
  const lastMessageTime = cachedBoundaries?.last;

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

  // Receive time of the latest message on `topic` at or before `time`, never earlier than `floor`.
  // Prefers the player's indexed backward lookup. Sources without one get backward windows that
  // grow geometrically and don't overlap, so the bytes read scale with the distance to the
  // message instead of the length of the recording before it.
  const findMessageAtOrBefore = useCallback(
    async (
      signal: AbortSignal,
      topic: string,
      time: Time,
      floor: Time = ZERO_TIME,
      initialWindowMs: number = DEFAULT_WINDOW_MS,
    ): Promise<Time | undefined> => {
      const event = await getMessageAtTime(topic, time, signal);
      if (event) {
        return event.receiveTime;
      }

      let end = time;
      // Terminates: windows grow geometrically until one reaches the floor.
      for (let windowMs = initialWindowMs; ; windowMs *= WINDOW_GROWTH_FACTOR) {
        let start = subtractMilliseconds(time, windowMs);
        const reachedFloor = compare(start, floor) <= 0;
        if (reachedFloor) {
          start = floor;
        }

        const iterator = iterateTimes(topic, { start, end });
        if (!iterator) {
          return undefined;
        }

        let found: Time | undefined;
        for await (const result of iterator) {
          if (signal.aborted) {
            return undefined;
          }
          if (result.type !== RESULT_TYPE_MESSAGE_EVENT) {
            continue;
          }
          if (compare(result.msgEvent.receiveTime, time) > 0) {
            break;
          }
          found = result.msgEvent.receiveTime;
        }

        if (signal.aborted) {
          return undefined;
        }
        if (found || reachedFloor) {
          return found;
        }
        end = start;
      }
    },
    [iterateTimes, getMessageAtTime],
  );

  const discoverBoundaries = useCallback(
    async (signal: AbortSignal, topic: string) => {
      const stats = topicStats?.get(topic);
      let first = stats?.firstMessageTime;
      let last = stats?.lastMessageTime;

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

      if (first && !last && endTime) {
        last = await findMessageAtOrBefore(signal, topic, endTime, first);
      }

      if (signal.aborted) {
        return;
      }
      if (first != undefined || last != undefined) {
        updateBoundariesCache(topic, { first, last });
      }
    },
    [topicStats, endTime, iterateTimes, findMessageAtOrBefore, updateBoundariesCache],
  );

  useEffect(() => {
    const alreadyCached = boundariesCache.has(topicName);
    if (!selected || !isTopicSubscribed || alreadyCached) {
      return;
    }

    const abortController = new AbortController();
    void discoverBoundaries(abortController.signal, topicName);

    return () => {
      abortController.abort();
    };
  }, [topicName, selected, discoverBoundaries, boundariesCache, isTopicSubscribed]);

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
          updateBoundariesCache(topicName, { last: currentTime });
        }
        return;
      }

      if (result.isLastMessage && !lastMessageTime) {
        updateBoundariesCache(topicName, { last: result.targetTime });
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
          targetMessagesInWindow: 10,
        });
      }

      const targetTime = await findMessageAtOrBefore(
        signal,
        topicName,
        subtractTime(currentTime, ONE_NANOSECOND),
        firstMessageTime ?? stats?.firstMessageTime ?? startTime,
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
