// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * The reads behind topic message navigation. Loaded on first use (see useTopicMessageNavigation),
 * so none of it weighs on startup.
 *
 * - All reads only need receive times: the payload-free inspection iterator is used when the
 *   player has one.
 * - Next message: direct seek from the current time; stops at the first message after it once
 *   the topic's last message time is known.
 * - Previous message / last message: see findMessageAtOrBefore. The read is proportional to the
 *   distance to the message, never the whole prefix.
 * - Boundaries: per-topic first/last times come from topicStats when the source reports them.
 *   Otherwise only the first message is read, and the last one is looked up backwards from the
 *   end time. The topic is never read in full.
 */

import { Time, add as addTime, compare } from "@foxglove/rostime";

import Logger from "@lichtblick/log";
import { MessagePipelineContext } from "@lichtblick/suite-base/components/MessagePipeline";
import { RESULT_TYPE_MESSAGE_EVENT } from "@lichtblick/suite-base/components/TopicList/constants";
import {
  DEFAULT_WINDOW_MS,
  WINDOW_GROWTH_FACTOR,
  calculateOptimalWindowMs,
  subtractMilliseconds,
} from "@lichtblick/suite-base/components/TopicList/timeWindowHelpers";
import { TopicStats } from "@lichtblick/suite-base/players/types";

const log = Logger.getLogger(__filename);

const ZERO_TIME: Time = Object.freeze({ sec: 0, nsec: 0 });
const ONE_NANOSECOND: Time = Object.freeze({ sec: 0, nsec: 1 });
// First window holds about this many messages: big windows read more chunks than they save in
// round trips (measured on indexed MCAP).
const WINDOW_TARGET_MESSAGES = 2;

/** What the reads need from the message pipeline. */
export type NavigationReads = {
  /** Receive times of `topic` in a range, payload-free when the player can. */
  iterateTimes: (
    topic: string,
    options?: { start?: Time; end?: Time },
  ) => ReturnType<MessagePipelineContext["getBatchIterator"]>;
  getMessageAtTime: MessagePipelineContext["getMessageAtTime"];
  /** The player's getMessageAtTime uses an index (PLAYER_CAPABILITIES.indexedBackfill). */
  hasIndexedBackfill: boolean;
  /** Recorded topics can be inspected; virtual ones (user-script or converter outputs) can't. */
  isRecorded: (topic: string) => boolean;
};

/** Size of the first backward window: about two messages at the topic's average rate. */
export function initialWindowMs(
  numMessages: number | undefined,
  first: Time | undefined,
  last: Time | undefined,
): number {
  return numMessages != undefined && first && last
    ? calculateOptimalWindowMs({
        numMessages,
        firstMessageTime: first,
        lastMessageTime: last,
        targetMessagesInWindow: WINDOW_TARGET_MESSAGES,
      })
    : DEFAULT_WINDOW_MS;
}

/**
 * Receive time of the last message on `topic` in [start, end], or undefined if there is none.
 * `aborted` is true when the read stopped early, either cancelled or because the source can't
 * iterate the topic.
 */
async function lastMessageIn(
  reads: NavigationReads,
  signal: AbortSignal,
  topic: string,
  start: Time,
  end: Time,
): Promise<{ found?: Time; aborted: boolean }> {
  const iterator = reads.iterateTimes(topic, { start, end });
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
}

/** Receive time of the latest message on `topic` at or before `time`, never earlier than `floor`. */
export async function findMessageAtOrBefore(
  reads: NavigationReads,
  signal: AbortSignal,
  topic: string,
  time: Time,
  floor: Time = ZERO_TIME,
  firstWindowMs: number = DEFAULT_WINDOW_MS,
): Promise<Time | undefined> {
  if (compare(time, floor) < 0) {
    return undefined;
  }
  // Backward windows that grow geometrically and don't overlap, so the bytes read scale with the
  // distance to the message instead of the length of the recording before it. The first one is
  // sized to hold a message or two, which settles most lookups in one small read.
  let end = time;
  // Terminates: windows grow geometrically until one reaches the floor.
  for (let windowMs = firstWindowMs; ; windowMs *= WINDOW_GROWTH_FACTOR) {
    let start = subtractMilliseconds(time, windowMs);
    const reachedFloor = compare(start, floor) <= 0;
    if (reachedFloor) {
      start = floor;
    }
    const scan = await lastMessageIn(reads, signal, topic, start, end);
    if (scan.aborted) {
      return undefined;
    }
    if (scan.found || reachedFloor) {
      return scan.found;
    }
    end = start;

    // The nearby window was empty: the message is further back. An indexed lookup jumps there
    // without scanning the distance, but only where it is cheap and real:
    // - indexed sources only; elsewhere backfill may decode everything up to `time`
    // - recorded topics only (they can be inspected); a converter's backfill runs a fresh
    //   converter on its latest input and may name a time with no real output
    // It can still miss newer messages (e.g. overlapping files), so its answer is a lower bound:
    // read the gap from it up to the empty window.
    if (windowMs === firstWindowMs && reads.hasIndexedBackfill && reads.isRecorded(topic)) {
      let candidate: Time | undefined;
      try {
        candidate = (await reads.getMessageAtTime(topic, end, signal))?.receiveTime;
      } catch (error) {
        if (signal.aborted) {
          return undefined;
        }
        const message = error instanceof Error ? error.message : String(error);
        log.warn(`Indexed lookup failed, scanning instead: ${message}`);
      }
      if (candidate && compare(candidate, end) <= 0) {
        const gap = await lastMessageIn(
          reads,
          signal,
          topic,
          addTime(candidate, ONE_NANOSECOND),
          end,
        );
        return gap.aborted && signal.aborted ? undefined : (gap.found ?? candidate);
      }
    }
  }
}

/**
 * First and last message times of `topic`. `last` stays undefined without an `end` to look back
 * from. Returns undefined when aborted or when the topic can't be read.
 */
export async function discoverTopicBoundaries(
  reads: NavigationReads,
  signal: AbortSignal,
  topic: string,
  known: { stats?: TopicStats; first?: Time; end?: Time },
): Promise<{ first?: Time; last?: Time } | undefined> {
  let first = known.stats?.firstMessageTime ?? known.first;
  let last = known.stats?.lastMessageTime;

  if (!first) {
    const iterator = reads.iterateTimes(topic);
    if (!iterator) {
      return undefined;
    }
    for await (const result of iterator) {
      if (signal.aborted) {
        return undefined;
      }
      if (result.type === RESULT_TYPE_MESSAGE_EVENT) {
        first = result.msgEvent.receiveTime;
        break;
      }
    }
  }

  if (first && !last && known.end) {
    const windowMs = initialWindowMs(known.stats?.numMessages ?? 0, first, known.end);
    last = await findMessageAtOrBefore(reads, signal, topic, known.end, first, windowMs);
  }
  return signal.aborted ? undefined : { first, last };
}

/** The first message after `current`, and whether it is the topic's last one. */
export async function findNextMessage(
  reads: NavigationReads,
  signal: AbortSignal,
  topic: string,
  current: Time,
  knownLast: Time | undefined,
): Promise<{ targetTime: Time; isLastMessage: boolean } | undefined> {
  // Seek directly to the current time instead of iterating from the beginning
  const iterator = reads.iterateTimes(topic, { start: current });
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
    if (compare(result.msgEvent.receiveTime, current) <= 0) {
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

  return targetTime ? { targetTime, isLastMessage: !foundMessageAfterTarget } : undefined;
}
