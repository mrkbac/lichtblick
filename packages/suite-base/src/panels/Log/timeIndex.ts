// SPDX-License-Identifier: MPL-2.0

import { compare, subtract, toSec } from "@foxglove/rostime";

import { Time } from "@lichtblick/suite";

import { LogLevel, NormalizedLogMessage } from "./types";

/**
 * Binary search over items sorted by receiveTime: the first index whose receiveTime is > `time`,
 * or >= `time` with `{ inclusive: true }`.
 */
export function searchByTime(
  items: readonly NormalizedLogMessage[],
  time: Time,
  { inclusive = false }: { inclusive?: boolean } = {},
): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const cmp = compare(items[mid]!.receiveTime, time);
    if (cmp < 0 || (!inclusive && cmp === 0)) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** Index of the last item at or before `time`, -1 if none. */
export function lastIndexAtOrBefore(items: readonly NormalizedLogMessage[], time: Time): number {
  return searchByTime(items, time) - 1;
}

/** Index of the item closest in time to `time` (the earlier one on a tie), -1 if empty. */
export function nearestIndex(items: readonly NormalizedLogMessage[], time: Time): number {
  const after = searchByTime(items, time, { inclusive: true });
  if (after === 0) {
    return items.length === 0 ? -1 : 0;
  }
  if (after === items.length) {
    return after - 1;
  }
  const gapAfter = toSec(subtract(items[after]!.receiveTime, time));
  const gapBefore = toSec(subtract(time, items[after - 1]!.receiveTime));
  return gapAfter < gapBefore ? after : after - 1;
}

/**
 * Find the nearest item with at least `minLevel` strictly after (`direction` 1) or strictly
 * before (`direction` -1) `time`. Returns -1 if there is none.
 */
export function findLevel(
  items: readonly NormalizedLogMessage[],
  time: Time | undefined,
  direction: 1 | -1,
  minLevel: LogLevel = LogLevel.WARN,
): number {
  let i: number;
  if (time == undefined) {
    i = direction === 1 ? 0 : items.length - 1;
  } else {
    i =
      direction === 1
        ? searchByTime(items, time)
        : searchByTime(items, time, { inclusive: true }) - 1;
  }
  for (; i >= 0 && i < items.length; i += direction) {
    if (items[i]!.level >= minLevel) {
      return i;
    }
  }
  return -1;
}
