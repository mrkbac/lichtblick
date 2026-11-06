// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare } from "@foxglove/rostime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMessagesByTopic } from "@lichtblick/suite-base/PanelAPI";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { useSubscribeMessageRange } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";

import { normalizeLogEvent } from "./conversion";
import { NormalizedLogMessage } from "./types";

/** Per-topic message limit for live sources, which can't be re-read. */
export const LIVE_HISTORY_SIZE = 50_000;
const FLUSH_INTERVAL_MS = 250;
const EMPTY: readonly string[] = [];

const pickKeys = (record: Readonly<Record<string, string>>, keys: ReadonlySet<string>) =>
  Object.fromEntries(Object.entries(record).filter(([key]) => keys.has(key)));

type ByTopic = Record<string, readonly NormalizedLogMessage[]>;

/** Copy the growing per-topic arrays so consumers see new references on every flush. */
const snapshot = (acc: Record<string, NormalizedLogMessage[]>): ByTopic =>
  Object.fromEntries(Object.entries(acc).map(([topic, messages]) => [topic, messages.slice()]));

/** Merge arrays that are each sorted by receiveTime into one sorted array. */
export function mergeByReceiveTime(
  arrays: readonly (readonly NormalizedLogMessage[])[],
): readonly NormalizedLogMessage[] {
  const nonEmpty = arrays.filter((arr) => arr.length > 0);
  if (nonEmpty.length <= 1) {
    return nonEmpty[0] ?? [];
  }
  // Pairwise merge: O(n log k) for k topics
  let merged = nonEmpty;
  while (merged.length > 1) {
    const next: (readonly NormalizedLogMessage[])[] = [];
    for (let i = 0; i < merged.length; i += 2) {
      const a = merged[i]!;
      const b = merged[i + 1];
      next.push(b ? mergeTwo(a, b) : a);
    }
    merged = next;
  }
  return merged[0]!;
}

function mergeTwo(
  a: readonly NormalizedLogMessage[],
  b: readonly NormalizedLogMessage[],
): NormalizedLogMessage[] {
  const out = new Array<NormalizedLogMessage>(a.length + b.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.length && j < b.length) {
    out[k++] = compare(b[j]!.receiveTime, a[i]!.receiveTime) < 0 ? b[j++]! : a[i++]!;
  }
  while (i < a.length) {
    out[k++] = a[i++]!;
  }
  while (j < b.length) {
    out[k++] = b[j++]!;
  }
  return out;
}

const selectPlayerId = (ctx: MessagePipelineContext) => ctx.playerState.playerId;
const selectLastSeekTime = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.lastSeekTime;
const selectReady = (ctx: MessagePipelineContext) =>
  ctx.playerState.presence === PlayerPresence.PRESENT ||
  ctx.playerState.presence === PlayerPresence.BUFFERING;

/**
 * All log messages of the given topics, sorted by receive time.
 *
 * Recorded sources: the whole recording is loaded via range iterators, independent of the
 * playhead. Live sources (no range support): a rolling buffer of the most recent messages.
 */
export function useLogMessages(topics: readonly string[]): {
  items: readonly NormalizedLogMessage[];
  loading: boolean;
  /** Why loading a topic failed, if one did */
  error: string | undefined;
  /** Reload the topics that failed */
  retry: () => void;
} {
  const playerId = useMessagePipeline(selectPlayerId);
  const ready = useMessagePipeline(selectReady);
  const subscribeMessageRange = useSubscribeMessageRange();

  const [rangeByTopic, setRangeByTopic] = useState<ByTopic>({});
  const [loadingTopics, setLoadingTopics] = useState<ReadonlySet<string>>(new Set());
  const [errorByTopic, setErrorByTopic] = useState<Readonly<Record<string, string>>>({});
  // Bumped by retry() to resubscribe the failed topics
  const [retryCount, setRetryCount] = useState(0);

  // Active range subscriptions, keyed by topic. Reset when the player changes.
  const subsRef = useRef(new Map<string, () => void>());
  const accumulatedRef = useRef<Record<string, NormalizedLogMessage[]>>({});
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const subs = subsRef.current;
    const acc = accumulatedRef.current;
    const flush = () => {
      flushTimerRef.current = undefined;
      setRangeByTopic(snapshot(acc));
    };

    let added = false;
    for (const topic of topics) {
      if (!ready || subs.has(topic)) {
        continue;
      }
      let cancelled = false;
      const cancelRange = subscribeMessageRange({
        topic,
        rethrowErrors: true,
        onNewRangeIterator: async (iterator) => {
          const messages: NormalizedLogMessage[] = [];
          acc[topic] = messages;
          setLoadingTopics((prev) => new Set(prev).add(topic));
          try {
            for await (const batch of iterator) {
              if (cancelled) {
                return;
              }
              for (const event of batch) {
                messages.push(normalizeLogEvent(event));
              }
              flushTimerRef.current ??= setTimeout(flush, FLUSH_INTERVAL_MS);
            }
          } catch (err) {
            if (!cancelled) {
              const message = err instanceof Error ? err.message : String(err);
              setErrorByTopic((prev) => ({ ...prev, [topic]: message }));
            }
          } finally {
            if (!cancelled) {
              // Also shows what was read before a failure
              setRangeByTopic(snapshot(acc));
              setLoadingTopics((prev) => {
                const next = new Set(prev);
                next.delete(topic);
                return next;
              });
            }
          }
        },
      });
      // onNewRangeIterator runs synchronously when the source supports ranges. Topics without
      // range support (live sources) are not tracked here so they use the live subscription.
      if (acc[topic] != undefined) {
        added = true;
        subs.set(topic, () => {
          cancelled = true;
          cancelRange();
        });
      }
    }

    // Drop topics that are no longer requested
    const wanted = new Set(topics);
    const removed = [...subs.keys()].filter((topic) => !wanted.has(topic));
    for (const topic of removed) {
      subs.get(topic)?.();
      subs.delete(topic);
      delete acc[topic];
    }
    if (removed.length > 0) {
      setLoadingTopics((prev) => new Set([...prev].filter((topic) => wanted.has(topic))));
      setErrorByTopic((prev) => pickKeys(prev, wanted));
    }
    if (added || removed.length > 0) {
      // Publish new (still empty) range topics right away so they skip the live subscription
      setRangeByTopic(snapshot(acc));
    }
    // playerId: resubscribe after the reset effect below cleared everything
  }, [topics, ready, subscribeMessageRange, playerId, retryCount]);

  // A new player invalidates everything loaded so far
  useEffect(() => {
    const subs = subsRef.current;
    const acc = accumulatedRef.current;
    return () => {
      subs.forEach((cancel) => {
        cancel();
      });
      subs.clear();
      for (const topic of Object.keys(acc)) {
        delete acc[topic];
      }
      if (flushTimerRef.current != undefined) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = undefined;
      }
      setRangeByTopic({});
      setLoadingTopics(new Set());
      setErrorByTopic({});
    };
  }, [playerId]);

  const retry = useCallback(() => {
    const subs = subsRef.current;
    const acc = accumulatedRef.current;
    for (const topic of Object.keys(errorByTopic)) {
      subs.get(topic)?.();
      subs.delete(topic);
      delete acc[topic];
    }
    setErrorByTopic({});
    setRangeByTopic(snapshot(acc));
    setRetryCount((count) => count + 1);
  }, [errorByTopic]);

  const liveTopics = useMemo(() => {
    const live = topics.filter((topic) => rangeByTopic[topic] == undefined);
    return live.length > 0 ? live : EMPTY;
  }, [topics, rangeByTopic]);

  const latestLiveByTopic = useMessagesByTopic({
    topics: liveTopics,
    historySize: LIVE_HISTORY_SIZE,
  });
  // Re-merging and re-filtering the whole live history per message batch is costly, so take
  // live updates at most every FLUSH_INTERVAL_MS (right away after a quiet period).
  // A seek or topic change replaces the history, so show that right away.
  const lastSeekTime = useMessagePipeline(selectLastSeekTime);
  const [liveByTopic, setLiveByTopic] = useState(latestLiveByTopic);
  const lastLiveFlushRef = useRef({ at: 0, liveTopics, lastSeekTime });
  useEffect(() => {
    if (latestLiveByTopic === liveByTopic) {
      return;
    }
    const last = lastLiveFlushRef.current;
    const reset = last.liveTopics !== liveTopics || last.lastSeekTime !== lastSeekTime;
    const timer = setTimeout(
      () => {
        lastLiveFlushRef.current = { at: Date.now(), liveTopics, lastSeekTime };
        setLiveByTopic(latestLiveByTopic);
      },
      reset ? 0 : Math.max(0, last.at + FLUSH_INTERVAL_MS - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [latestLiveByTopic, liveByTopic, liveTopics, lastSeekTime]);

  const items = useMemo(() => {
    const arrays: (readonly NormalizedLogMessage[])[] = [];
    for (const topic of topics) {
      const range = rangeByTopic[topic];
      if (range) {
        arrays.push(range);
      } else {
        const live = liveByTopic[topic];
        if (live) {
          arrays.push(live.map(normalizeLogEvent));
        }
      }
    }
    return mergeByReceiveTime(arrays);
  }, [topics, rangeByTopic, liveByTopic]);

  const error = Object.entries(errorByTopic)
    .map(([topic, message]) => `${topic}: ${message}`)
    .join("\n");
  return { items, loading: loadingTopics.size > 0, error: error === "" ? undefined : error, retry };
}
