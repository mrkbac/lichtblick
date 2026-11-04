// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { DiagnosticId } from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import { LEVELS } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";

/** The check entered `level` at receive time `t` (seconds). */
export type LevelChange = { t: number; level: number };

/** Level changes of one check plus the receive time (seconds) of its latest message. */
export type CheckHistory = { changes: readonly LevelChange[]; lastSeen: number };

export type HistoryById = Map<DiagnosticId, CheckHistory>;

/** Ordering used when several levels fall into one timeline pixel: the worst one wins. */
const SEVERITY: Record<number, number> = {
  [LEVELS.OK]: 0,
  [LEVELS.STALE]: 1,
  [LEVELS.WARN]: 2,
  [LEVELS.ERROR]: 3,
};

const severity = (level: number) => SEVERITY[level] ?? level;

/**
 * Level changes caused by seeing `level` at time `t`. A gap longer than `staleSec` since the
 * previous message adds a STALE change at the moment the check went stale.
 */
export function changesFor(
  prev: CheckHistory | undefined,
  level: number,
  t: number,
  staleSec: number,
): LevelChange[] {
  if (!prev) {
    return [{ t, level }];
  }
  const out: LevelChange[] = [];
  let last = prev.changes[prev.changes.length - 1]?.level;
  if (staleSec > 0 && t - prev.lastSeen > staleSec && last !== LEVELS.STALE) {
    out.push({ t: prev.lastSeen + staleSec, level: LEVELS.STALE });
    last = LEVELS.STALE;
  }
  if (level !== last) {
    out.push({ t, level });
  }
  return out;
}

/** Index of the last change at or before `t`, or -1. */
function lastChangeIndex(changes: readonly LevelChange[], t: number): number {
  let lo = 0;
  let hi = changes.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (changes[mid]!.t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** The level a check was in at time `t` and since when, or undefined before its first message. */
export function levelAt(
  history: CheckHistory,
  t: number,
  staleSec: number,
): LevelChange | undefined {
  const change = history.changes[lastChangeIndex(history.changes, t)];
  if (!change) {
    return undefined;
  }
  const staleSince = history.lastSeen + staleSec;
  if (staleSec > 0 && t > staleSince && change.level !== LEVELS.STALE && change.t < staleSince) {
    return { t: staleSince, level: LEVELS.STALE };
  }
  return change;
}

/** A horizontal run of timeline buckets [x, x + w) that all show `level`. */
export type TimelineRun = { x: number; w: number; level: number };

/**
 * Downsamples a check's history to `buckets` columns between `start` and `end` (seconds), keeping
 * the worst level per column so short errors stay visible, then merges equal neighbours.
 */
export function toTimelineRuns(
  history: CheckHistory,
  start: number,
  end: number,
  buckets: number,
  staleSec: number,
): TimelineRun[] {
  const span = end - start;
  if (span <= 0 || history.changes.length === 0) {
    return [];
  }
  const columns: (number | undefined)[] = new Array(buckets);
  const paint = (from: number, to: number, level: number) => {
    const first = Math.max(0, Math.floor(((from - start) / span) * buckets));
    const last = Math.min(buckets - 1, Math.ceil(((to - start) / span) * buckets) - 1);
    for (let i = first; i <= last; i++) {
      const current = columns[i];
      if (current == undefined || severity(level) > severity(current)) {
        columns[i] = level;
      }
    }
  };

  const { changes, lastSeen } = history;
  for (let i = 0; i < changes.length; i++) {
    const { t, level } = changes[i]!;
    const next = changes[i + 1];
    if (next) {
      paint(t, next.t, level);
    } else if (staleSec > 0 && level !== LEVELS.STALE && lastSeen + staleSec < end) {
      paint(t, lastSeen + staleSec, level);
      paint(lastSeen + staleSec, end, LEVELS.STALE);
    } else {
      paint(t, end, level);
    }
  }

  const runs: TimelineRun[] = [];
  for (let i = 0; i < buckets; i++) {
    const level = columns[i];
    if (level == undefined) {
      continue;
    }
    const prev = runs[runs.length - 1];
    if (prev?.level === level && prev.x + prev.w === i) {
      prev.w++;
    } else {
      runs.push({ x: i, w: 1, level });
    }
  }
  return runs;
}

/** Appends `added` to `changes`, dropping the oldest entries beyond `max`. */
export function appendBounded(
  changes: readonly LevelChange[],
  added: readonly LevelChange[],
  max: number,
): LevelChange[] {
  const next = [...changes, ...added];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Compact elapsed time, e.g. "8s", "3m 04s", "2h 05m". */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) {
    return `${s}s`;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  if (s < 3600) {
    return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  }
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
}
