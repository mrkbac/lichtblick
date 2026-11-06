// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** x/y columns of a computed spectrum or histogram outline */
export type AnalysisColumns = { x: Float64Array; y: Float64Array };

/** Resampled FFT input is capped so a long recording sampled fast stays fast and fits in memory. */
export const MAX_FFT_SAMPLES = 1 << 21;
const MAX_AUTO_BINS = 1000;
const MAX_BINS = 10_000;

/** In-place iterative radix-2 FFT. Both arrays must have the same power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tRe = re[b]! * curRe - im[b]! * curIm;
        const tIm = re[b]! * curIm + im[b]! * curRe;
        re[b] = re[a]! - tRe;
        im[b] = im[a]! - tIm;
        re[a] = re[a]! + tRe;
        im[a] = im[a]! + tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * Single-sided amplitude spectrum of the samples in rows [start, end) of time-sorted columns.
 *
 * Sampling is rarely even (message jitter, dropped messages), so the samples are linearly
 * resampled onto a grid at the median sample interval. Then the mean is removed, a Hann window is
 * applied and the signal is zero-padded to a power of two. A sine of amplitude A peaks at about A.
 * Rows with a NaN x or y are skipped. Undefined when there are too few samples.
 */
export function computeSpectrum(
  xs: Float64Array,
  ys: Float64Array,
  start: number,
  end: number,
): AnalysisColumns | undefined {
  const tx: number[] = [];
  const ty: number[] = [];
  for (let i = start; i < end; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    // Several values per message share a time; keep the first
    if (Number.isFinite(x) && Number.isFinite(y) && (tx.length === 0 || x > tx[tx.length - 1]!)) {
      tx.push(x);
      ty.push(y);
    }
  }
  if (tx.length < 4) {
    return undefined;
  }

  const diffs = new Float64Array(tx.length - 1);
  for (let i = 1; i < tx.length; i++) {
    diffs[i - 1] = tx[i]! - tx[i - 1]!;
  }
  diffs.sort();
  const span = tx[tx.length - 1]! - tx[0]!;
  // ponytail: gaps are interpolated over; a long gap smears low frequencies. Split at gaps
  // (Welch averaging) if that matters.
  const count = Math.min(Math.floor(span / diffs[diffs.length >> 1]!) + 1, MAX_FFT_SAMPLES);
  const dt = span / (count - 1);

  let size = 1;
  while (size < count) {
    size <<= 1;
  }
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let mean = 0;
  for (let i = 0, j = 0; i < count; i++) {
    const t = tx[0]! + i * dt;
    while (j < tx.length - 2 && tx[j + 1]! < t) {
      j++;
    }
    const frac = Math.min(Math.max((t - tx[j]!) / (tx[j + 1]! - tx[j]!), 0), 1);
    const value = ty[j]! + frac * (ty[j + 1]! - ty[j]!);
    re[i] = value;
    mean += value;
  }
  mean /= count;

  let windowSum = 0;
  for (let i = 0; i < count; i++) {
    const w = count > 1 ? 0.5 * (1 - Math.cos((2 * Math.PI * i) / (count - 1))) : 1;
    windowSum += w;
    re[i] = (re[i]! - mean) * w;
  }
  fft(re, im);

  const bins = (size >> 1) + 1;
  const x = new Float64Array(bins);
  const y = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    x[k] = k / (size * dt);
    // Energy of the positive and negative frequency folds into one side, except at DC and Nyquist
    const scale = (k === 0 || k === size >> 1 ? 1 : 2) / windowSum;
    y[k] = Math.hypot(re[k]!, im[k]!) * scale;
  }
  return { x, y };
}

/** Value at quantile q (0..1) of sorted values, linearly interpolated */
function quantile(sorted: Float64Array, q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (pos - lo) * (sorted[hi]! - sorted[lo]!);
}

/**
 * Automatic bin count: the larger of Freedman–Diaconis (robust to outliers) and Sturges (good for
 * small or tightly clustered data), like numpy's "auto".
 */
export function autoBinCount(sorted: Float64Array): number {
  const n = sorted.length;
  const range = sorted[n - 1]! - sorted[0]!;
  if (n < 2 || range <= 0) {
    return 1;
  }
  const sturges = Math.ceil(Math.log2(n)) + 1;
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const fdWidth = (2 * iqr) / Math.cbrt(n);
  const fd = fdWidth > 0 ? Math.ceil(range / fdWidth) : 0;
  return Math.min(Math.max(sturges, fd), MAX_AUTO_BINS);
}

/**
 * Histogram of the finite values in rows [start, end), as the points of a closed step outline so
 * that several series stay readable on top of each other. `binCount` overrides the automatic bin
 * count. Also returns the edges and counts. Undefined when there are no finite values.
 */
export function computeHistogram(
  ys: Float64Array,
  start: number,
  end: number,
  binCount?: number,
): (AnalysisColumns & { edges: Float64Array; counts: Float64Array }) | undefined {
  const values: number[] = [];
  for (let i = start; i < end; i++) {
    const y = ys[i]!;
    if (Number.isFinite(y)) {
      values.push(y);
    }
  }
  if (values.length === 0) {
    return undefined;
  }
  const sorted = Float64Array.from(values).sort();
  let min = sorted[0]!;
  let max = sorted[sorted.length - 1]!;
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }
  const bins =
    binCount != undefined && binCount >= 1
      ? Math.min(Math.round(binCount), MAX_BINS)
      : autoBinCount(sorted);
  const width = (max - min) / bins;
  const edges = new Float64Array(bins + 1);
  for (let i = 0; i <= bins; i++) {
    edges[i] = min + i * width;
  }
  const counts = new Float64Array(bins);
  for (const value of sorted) {
    // The last bin includes the maximum
    const bin = Math.min(Math.floor((value - min) / width), bins - 1);
    counts[bin] = counts[bin]! + 1;
  }

  const x = new Float64Array(2 * bins + 2);
  const y = new Float64Array(2 * bins + 2);
  x[0] = edges[0]!;
  for (let i = 0; i < bins; i++) {
    x[2 * i + 1] = edges[i]!;
    y[2 * i + 1] = counts[i]!;
    x[2 * i + 2] = edges[i + 1]!;
    y[2 * i + 2] = counts[i]!;
  }
  x[2 * bins + 1] = edges[bins]!;
  return { x, y, edges, counts };
}
