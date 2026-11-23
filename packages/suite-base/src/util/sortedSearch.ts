// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** First index in [from, to) of sorted `xs` whose value is > `value` (or `to`). */
export function upperBound(xs: ArrayLike<number>, from: number, to: number, value: number): number {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid]! <= value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** First index in [from, to) of sorted `xs` whose value is >= `value` (or `to`). */
export function lowerBound(xs: ArrayLike<number>, from: number, to: number, value: number): number {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid]! < value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}
