// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** Number of equal time slices in RecordingFileInfo.messageBytes */
export const DENSITY_BUCKETS = 1024;

/**
 * Adds `amount`, spread evenly over [spanStart, spanEnd], to `buckets`: equal slices of
 * [rangeStart, rangeEnd]. The part of the span outside the range is dropped. All in one unit.
 */
export function addSpan(
  buckets: Float32Array,
  rangeStart: number,
  rangeEnd: number,
  spanStart: number,
  spanEnd: number,
  amount: number,
): void {
  const n = buckets.length;
  if (n === 0 || spanEnd < rangeStart || spanStart > rangeEnd) {
    return;
  }
  const width = (rangeEnd - rangeStart) / n;
  if (!(width > 0)) {
    buckets[0]! += amount;
    return;
  }
  const a = (spanStart - rangeStart) / width;
  const b = (spanEnd - rangeStart) / width;
  if (b <= a) {
    buckets[Math.min(Math.max(Math.floor(a), 0), n - 1)]! += amount;
    return;
  }
  const perBucket = amount / (b - a);
  const first = Math.max(Math.floor(a), 0);
  const last = Math.min(Math.ceil(b), n);
  for (let i = first; i < last; i++) {
    buckets[i]! += perBucket * (Math.min(b, i + 1) - Math.max(a, i));
  }
}

/**
 * Bytes over time in fixed buckets that double their width when a span ends past the last one,
 * so adding costs the same however much was added before. Times in one unit (e.g. ns).
 */
export class GrowingHistogram {
  #origin: number;
  #width: number;
  readonly #bytes = new Float32Array(2 * DENSITY_BUCKETS);

  public constructor(origin: number, span: number) {
    this.#origin = origin;
    this.#width = Math.max(span, 1) / this.#bytes.length;
  }

  /** ponytail: a span starting before the origin is clamped to it (out-of-order chunks only) */
  public add(start: number, end: number, amount: number): void {
    const bytes = this.#bytes;
    const n = bytes.length;
    while (end > this.#origin + this.#width * n) {
      for (let i = 0; i < n / 2; i++) {
        bytes[i] = bytes[2 * i]! + bytes[2 * i + 1]!;
      }
      bytes.fill(0, n / 2);
      this.#width *= 2;
    }
    const origin = this.#origin;
    addSpan(bytes, origin, origin + this.#width * n, Math.max(start, origin), end, amount);
  }

  /** The bytes in DENSITY_BUCKETS equal slices of [start, end] */
  public resample(start: number, end: number): Float32Array {
    const out = new Float32Array(DENSITY_BUCKETS);
    const origin = this.#origin;
    const width = this.#width;
    this.#bytes.forEach((amount, i) => {
      if (amount > 0) {
        addSpan(out, start, end, origin + i * width, origin + (i + 1) * width, amount);
      }
    });
    return out;
  }
}
