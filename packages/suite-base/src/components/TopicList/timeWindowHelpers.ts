// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";

// Time conversion constants
const NANOSECONDS_PER_MILLISECOND = 1_000_000;
const NANOSECONDS_PER_SECOND = 1_000_000_000;

// Window size constants (in milliseconds)
export const DEFAULT_WINDOW_MS = 500;
const MIN_WINDOW_MS = 100;
const MAX_WINDOW_MS = 30 * 1000; // 30 seconds

// Adaptive window calculation constants
const DEFAULT_TARGET_MESSAGES = 10;
export const WINDOW_GROWTH_FACTOR = 5;

/**
 * Subtracts milliseconds from a Time, handling nanosecond overflow correctly.
 */
export function subtractMilliseconds(time: Time, milliseconds: number): Time {
  // Split into whole seconds and a sub-second remainder so huge windows stay O(1) and exact.
  const wholeSeconds = Math.floor(milliseconds / 1000);
  const remainderNs = Math.round(
    (milliseconds - wholeSeconds * 1000) * NANOSECONDS_PER_MILLISECOND,
  );
  let sec = time.sec - wholeSeconds;
  let nsec = time.nsec - remainderNs;
  if (nsec < 0) {
    nsec += NANOSECONDS_PER_SECOND;
    sec -= 1;
  }
  return { sec, nsec };
}

/**
 * Converts Time to seconds (decimal).
 */
export function timeToSec(time: Time): number {
  return time.sec + time.nsec / NANOSECONDS_PER_SECOND;
}

/**
 * Calculates an optimal time window size for finding messages based on topic statistics.
 * Returns the window size in milliseconds.
 */
export function calculateOptimalWindowMs(params: {
  numMessages: number;
  firstMessageTime: Time;
  lastMessageTime: Time;
  targetMessagesInWindow?: number;
}): number {
  const {
    numMessages,
    firstMessageTime,
    lastMessageTime,
    targetMessagesInWindow = DEFAULT_TARGET_MESSAGES,
  } = params;

  const totalDurationSec = timeToSec(lastMessageTime) - timeToSec(firstMessageTime);

  if (totalDurationSec <= 0 || numMessages <= 0) {
    return DEFAULT_WINDOW_MS;
  }

  const messagesPerSecond = numMessages / totalDurationSec;

  if (messagesPerSecond === 0) {
    return MAX_WINDOW_MS;
  }

  const estimatedWindowSec = targetMessagesInWindow / messagesPerSecond;

  // Clamp between min and max window sizes
  const windowMs = Math.max(MIN_WINDOW_MS, Math.min(MAX_WINDOW_MS, estimatedWindowSec * 1000));

  return windowMs;
}
