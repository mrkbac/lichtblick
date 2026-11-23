// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";

// Time conversion constants
const NANOSECONDS_PER_MILLISECOND = 1_000_000;
const NANOSECONDS_PER_SECOND = 1_000_000_000;

// Window size constants (in milliseconds)
export const DEFAULT_WINDOW_MS = 500;
export const MIN_WINDOW_MS = 100;
export const MAX_WINDOW_MS = 30 * 1000; // 30 seconds
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
  // The input's nsec may be fractional (computed times): keep an integer nanosecond count
  return { sec, nsec: Math.round(nsec) };
}
