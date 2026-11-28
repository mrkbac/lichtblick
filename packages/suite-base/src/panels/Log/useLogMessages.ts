// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare, Time } from "@foxglove/rostime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { pushAll } from "@lichtblick/den/collection";
import { useShallowMemo } from "@lichtblick/hooks";
import { useMessageHistory } from "@lichtblick/suite-base/PanelAPI";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  selectLastSeekTime,
  selectPlayerId,
} from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { useSubscribeMessageRange } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { LiveHistoryRead } from "@lichtblick/suite-base/components/PanelExtensionAdapter/LiveHistoryRead";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";

import { clearLogStrings, normalizeLogEvent } from "./conversion";
import { searchByTime } from "./timeIndex";
import { NormalizedLogMessage } from "./types";

/** Per-topic message limit for live sources, which can't be re-read. */
export const LIVE_HISTORY_SIZE = 50_000;
/** Lines kept per topic of a live session's history (and its live lines after it), as Map does */
const LIVE_MAX_LINES = 1_000_000;
const FLUSH_INTERVAL_MS = 250;

const pickKeys = (record: Readonly<Record<string, string>>, keys: ReadonlySet<string>) =>
  Object.fromEntries(Object.entries(record).filter(([key]) => keys.has(key)));

type RangeState = {
  /** Topics read from the recorded range or the live session's history. */
  topics: ReadonlySet<string>;
  /**
   * Topics read from the live session's history, with their newest message so far: their live
   * messages after it go on from the rolling buffer.
   */
  liveHistoryNewest: ReadonlyMap<string, Time | undefined>;
  /** Their messages, merged by receive time. */
  items: readonly NormalizedLogMessage[];
};
const EMPTY_RANGE: RangeState = { topics: new Set(), liveHistoryNewest: new Map(), items: [] };

/**
 * Range messages of all topics, merged by receive time. Batches wait per topic until the next
 * flush, which merges only them into the merged list instead of re-merging from the start; the
 * merged list is the only full copy kept.
 */
export class RangeAccumulator {
  readonly #maxLiveLines: number;
  /** Topics read from the range; their messages not yet merged. */
  #pending = new Map<string, NormalizedLogMessage[]>();
  #merged: readonly NormalizedLogMessage[] = [];
  /** Topics whose merged messages must go on the next flush. */
  #removed = new Set<string>();
  #liveHistory = new Map<string, LiveHistoryRead<NormalizedLogMessage>>();
  /** Lines of each live history topic, merged or not */
  #liveCounts = new Map<string, number>();
  /** The last snapshot, handed out again while nothing changed */
  #last: RangeState = EMPTY_RANGE;
  #changed = false;

  public constructor(maxLiveLines = LIVE_MAX_LINES) {
    this.#maxLiveLines = maxLiveLines;
  }

  public has(topic: string): boolean {
    return this.#pending.has(topic);
  }

  /** Start (or restart, replacing what was loaded) reading a topic. */
  public reset(topic: string, { liveHistory }: { liveHistory: boolean }): void {
    this.delete(topic);
    this.#pending.set(topic, []);
    if (liveHistory) {
      this.#liveHistory.set(topic, new LiveHistoryRead());
      this.#liveCounts.set(topic, 0);
    }
    this.#changed = true;
  }

  public push(topic: string, message: NormalizedLogMessage): void {
    this.#pending.get(topic)?.push(message);
    const read = this.#liveHistory.get(topic);
    if (read) {
      read.read([message]);
      this.#liveCounts.set(topic, (this.#liveCounts.get(topic) ?? 0) + 1);
    }
    this.#changed = true;
  }

  /** A topic's history read ended */
  public end(topic: string): void {
    this.#liveHistory.get(topic)?.end();
  }

  /**
   * Keep a live history topic's live messages after what it has, once its read ended: the
   * rolling live buffer drops its oldest, which would leave a gap after the history.
   */
  public appendLive(topic: string, live: readonly NormalizedLogMessage[]): boolean {
    const read = this.#liveHistory.get(topic);
    if (!read || read.reading()) {
      return false;
    }
    const newest = read.newest();
    const after = newest ? live.slice(searchByTime(live, newest)) : live;
    for (const message of after) {
      this.push(topic, message);
    }
    return after.length > 0;
  }

  public delete(topic: string): void {
    if (this.#pending.delete(topic)) {
      this.#removed.add(topic);
      this.#liveHistory.delete(topic);
      this.#liveCounts.delete(topic);
      this.#changed = true;
    }
  }

  public clear(): void {
    this.#pending.clear();
    this.#merged = [];
    this.#removed.clear();
    this.#liveHistory.clear();
    this.#liveCounts.clear();
    this.#last = EMPTY_RANGE;
    this.#changed = false;
  }

  /** A new items array whenever something changed, else the previous state. */
  public snapshot(): RangeState {
    if (!this.#changed) {
      return this.#last;
    }
    this.#changed = false;
    let merged = this.#merged;
    if (this.#removed.size > 0) {
      const removed = this.#removed;
      merged = merged.filter((message) => !removed.has(message.topic));
      this.#removed = new Set();
    }
    // Read around the playhead first, a topic's messages since the last flush can hold an earlier
    // window after a later one
    const batches = [...this.#pending.values()].map((messages) =>
      messages.every((m, i) => i === 0 || compare(messages[i - 1]!.receiveTime, m.receiveTime) <= 0)
        ? messages
        : messages.toSorted((a, b) => compare(a.receiveTime, b.receiveTime)),
    );
    for (const topic of this.#pending.keys()) {
      this.#pending.set(topic, []);
    }
    const added = mergeByReceiveTime(batches);
    let next: NormalizedLogMessage[];
    if (added.length === 0) {
      next = merged.slice();
    } else {
      // Only the tail at or after the earliest new message needs merging.
      const start = searchByTime(merged, added[0]!.receiveTime);
      next = merged.slice(0, start);
      pushAll(next, mergeTwo(merged.slice(start), added));
    }
    // A live session runs for hours: past the cap, drop a topic's oldest lines (the first ones in
    // the sorted list), with slack so this doesn't run on every flush
    const drop = new Map<string, number>();
    for (const [topic, count] of this.#liveCounts) {
      if (count > this.#maxLiveLines) {
        const keep = Math.floor(this.#maxLiveLines * 0.9);
        drop.set(topic, count - keep);
        this.#liveCounts.set(topic, keep);
      }
    }
    if (drop.size > 0) {
      next = next.filter((message) => {
        const left = drop.get(message.topic) ?? 0;
        drop.set(message.topic, left - 1);
        return left <= 0;
      });
    }
    this.#merged = next;
    this.#last = {
      topics: new Set(this.#pending.keys()),
      liveHistoryNewest: new Map(
        Array.from(this.#liveHistory, ([topic, read]) => [topic, read.newest()]),
      ),
      items: next,
    };
    return this.#last;
  }
}

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

const selectReady = (ctx: MessagePipelineContext) =>
  ctx.playerState.presence === PlayerPresence.PRESENT ||
  ctx.playerState.presence === PlayerPresence.BUFFERING;

/**
 * All log messages of the given topics, sorted by receive time.
 *
 * Recorded sources: the whole recording is loaded via range iterators, independent of the
 * playhead. Live sources: what the session kept so far, then a rolling buffer of the most recent
 * messages.
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

  const [range, setRange] = useState<RangeState>(EMPTY_RANGE);
  const [loadingTopics, setLoadingTopics] = useState<ReadonlySet<string>>(new Set());
  const [errorByTopic, setErrorByTopic] = useState<Readonly<Record<string, string>>>({});
  // Bumped by retry() to resubscribe the failed topics
  const [retryCount, setRetryCount] = useState(0);

  // Active range subscriptions, keyed by topic. Reset when the player changes.
  const subsRef = useRef(new Map<string, () => void>());
  const accumulatedRef = useRef(new RangeAccumulator());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const subs = subsRef.current;
    const acc = accumulatedRef.current;
    const flush = () => {
      flushTimerRef.current = undefined;
      setRange(acc.snapshot());
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
        // The lines around the playhead, where the list scrolls to, show first
        playheadFirst: true,
        // A live source's log starts with what the session kept, not when the panel opened
        liveHistory: true,
        onNewRangeIterator: async (iterator, info) => {
          acc.reset(topic, { liveHistory: info?.liveHistory === true });
          setLoadingTopics((prev) => new Set(prev).add(topic));
          try {
            for await (const batch of iterator) {
              if (cancelled) {
                return;
              }
              for (const event of batch) {
                acc.push(topic, normalizeLogEvent(event));
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
              acc.end(topic);
              // Also shows what was read before a failure
              setRange(acc.snapshot());
              setLoadingTopics((prev) => {
                const next = new Set(prev);
                next.delete(topic);
                return next;
              });
            }
          }
        },
      });
      // onNewRangeIterator runs synchronously when the source supports ranges or keeps a live
      // history. Topics without either are not tracked here and use the live subscription only.
      if (acc.has(topic)) {
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
      acc.delete(topic);
    }
    if (removed.length > 0) {
      setLoadingTopics((prev) => prev.intersection(wanted));
      setErrorByTopic((prev) => pickKeys(prev, wanted));
    }
    if (added || removed.length > 0) {
      // Publish new (still empty) range topics right away so they skip the live subscription
      setRange(acc.snapshot());
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
      acc.clear();
      clearLogStrings();
      if (flushTimerRef.current != undefined) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = undefined;
      }
      setRange(EMPTY_RANGE);
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
      acc.delete(topic);
    }
    setErrorByTopic({});
    setRange(acc.snapshot());
    setRetryCount((count) => count + 1);
  }, [errorByTopic]);

  // Same content, same array: a new one would reset the live subscription's throttle
  const liveTopics = useShallowMemo(
    topics.filter((topic) => !range.topics.has(topic) || range.liveHistoryNewest.has(topic)),
  );

  // Normalized once on arrival; the raw messages are not kept.
  const latestLiveByTopic = useMessageHistory({
    topics: liveTopics,
    historySize: LIVE_HISTORY_SIZE,
    map: normalizeLogEvent,
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
        const acc = accumulatedRef.current;
        let appended = false;
        for (const topic of liveTopics) {
          const live = latestLiveByTopic[topic];
          if (live && acc.appendLive(topic, live.toArray())) {
            appended = true;
          }
        }
        if (appended) {
          setRange(acc.snapshot());
        }
        setLiveByTopic(latestLiveByTopic);
      },
      reset ? 0 : Math.max(0, last.at + FLUSH_INTERVAL_MS - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [latestLiveByTopic, liveByTopic, liveTopics, lastSeekTime]);

  // Live histories are bounded, so merging them on each (throttled) update is bounded too.
  const items = useMemo(() => {
    const arrays: (readonly NormalizedLogMessage[])[] = [range.items];
    for (const topic of liveTopics) {
      const live = liveByTopic[topic]?.toArray();
      if (live) {
        // The history read has the messages up to its newest
        const newest = range.liveHistoryNewest.get(topic);
        arrays.push(newest ? live.slice(searchByTime(live, newest)) : live);
      }
    }
    return mergeByReceiveTime(arrays);
  }, [liveTopics, range.items, range.liveHistoryNewest, liveByTopic]);

  const error = Object.entries(errorByTopic)
    .map(([topic, message]) => `${topic}: ${message}`)
    .join("\n");
  return { items, loading: loadingTopics.size > 0, error: error === "" ? undefined : error, retry };
}
