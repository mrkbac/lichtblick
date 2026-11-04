// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time, toSec } from "@lichtblick/rostime";
import { TopicStats } from "@lichtblick/suite-base/players/types";

export type TopicHealthStatus = "ok" | "slow" | "stale" | "unmeasured";

export type TopicSettings = {
  /** Expected publish rate; 0 disables monitoring, undefined uses the learned rate. */
  expectedHz?: number;
  /** Seconds without a message before the topic is stale; undefined derives it from the rate. */
  staleAfterSec?: number;
  /** Subscribe on live sources / scan recordings for jitter, gaps and bandwidth. */
  deepStats?: boolean;
};

export type TopicHealthConfig = {
  /** Show problems first instead of alphabetical order. */
  sortByStatus?: boolean;
  /** Allowed rate shortfall in percent before a topic counts as slow. */
  tolerancePercent: number;
  topics: Record<string, TopicSettings>;
};

export const DEFAULT_CONFIG: TopicHealthConfig = {
  tolerancePercent: 20,
  topics: {},
};

/** Rates are learned only after enough messages, so one-shot (latched) topics never go stale. */
const MIN_MESSAGES_TO_LEARN = 10;
const MIN_STALE_SEC = 1;
const STALE_PERIODS = 5;
const SMOOTHING = 0.3;
export const HISTORY_LENGTH = 60;

export type RateSample = {
  count: number;
  timeMs: number;
  /** Smoothed rate; decays towards zero while a topic is silent. */
  hz?: number;
  /** Highest smoothed rate seen, used as the automatic expectation. */
  peakHz?: number;
  /** Wall time when the count last changed. */
  lastMessageMs?: number;
  /** Rate per sampling tick, oldest first. */
  history: number[];
};

/** Samples cumulative live counts; call on a fixed interval, never per message. */
export function sampleLiveRates(
  previous: ReadonlyMap<string, RateSample>,
  stats: ReadonlyMap<string, TopicStats> | undefined,
  nowMs: number,
): Map<string, RateSample> {
  const next = new Map<string, RateSample>();
  for (const [topic, stat] of stats ?? []) {
    const last = previous.get(topic);
    if (!last) {
      next.set(topic, {
        count: stat.numMessages,
        timeMs: nowMs,
        lastMessageMs: stat.numMessages > 0 ? nowMs : undefined,
        history: [],
      });
      continue;
    }
    const seconds = (nowMs - last.timeMs) / 1000;
    if (seconds <= 0) {
      next.set(topic, last);
      continue;
    }
    // A player reset (reconnect) makes counts go backwards; treat it as a fresh start.
    const delta = Math.max(0, stat.numMessages - last.count);
    const instant = delta / seconds;
    const hz = last.hz == undefined ? instant : last.hz + SMOOTHING * (instant - last.hz);
    next.set(topic, {
      count: stat.numMessages,
      timeMs: nowMs,
      hz,
      peakHz:
        stat.numMessages >= MIN_MESSAGES_TO_LEARN ? Math.max(last.peakHz ?? 0, hz) : last.peakHz,
      lastMessageMs: delta > 0 ? nowMs : last.lastMessageMs,
      history: [...last.history.slice(1 - HISTORY_LENGTH), instant],
    });
  }
  return next;
}

/** Average rate over a recording, or undefined with too few messages. */
export function recordingRate(stat: TopicStats | undefined): number | undefined {
  if (!stat?.firstMessageTime || !stat.lastMessageTime || stat.numMessages < 2) {
    return undefined;
  }
  const seconds = toSec(stat.lastMessageTime) - toSec(stat.firstMessageTime);
  return seconds > 0 ? (stat.numMessages - 1) / seconds : undefined;
}

/** Seconds since the last message at playback `currentTime`; 0 while the topic is still active. */
export function recordingAge(
  stat: TopicStats | undefined,
  currentTime: Time | undefined,
): number | undefined {
  if (!stat?.lastMessageTime || !currentTime) {
    return undefined;
  }
  return Math.max(0, toSec(currentTime) - toSec(stat.lastMessageTime));
}

export function staleAfterSec(
  settings: TopicSettings | undefined,
  expectedHz: number | undefined,
): number | undefined {
  if (settings?.staleAfterSec != undefined) {
    return settings.staleAfterSec;
  }
  return expectedHz != undefined && expectedHz > 0
    ? Math.max(MIN_STALE_SEC, STALE_PERIODS / expectedHz)
    : undefined;
}

export function topicStatus(options: {
  rateHz?: number;
  expectedHz?: number;
  ageSec?: number;
  staleAfterSec?: number;
  tolerancePercent: number;
}): TopicHealthStatus {
  const { rateHz, expectedHz, ageSec, staleAfterSec: staleAfter, tolerancePercent } = options;
  if (expectedHz === 0) {
    return "ok";
  }
  if (ageSec != undefined && staleAfter != undefined && ageSec > staleAfter) {
    return "stale";
  }
  if (rateHz == undefined) {
    return ageSec == undefined ? "unmeasured" : "ok";
  }
  if (expectedHz != undefined && rateHz < expectedHz * (1 - tolerancePercent / 100)) {
    return "slow";
  }
  return "ok";
}

export const STATUS_ORDER: Record<TopicHealthStatus, number> = {
  stale: 0,
  slow: 1,
  unmeasured: 2,
  ok: 3,
};
