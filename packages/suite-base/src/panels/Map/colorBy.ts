// SPDX-License-Identifier: MPL-2.0

import { lowerBound, upperBound } from "@lichtblick/suite-base/util/sortedSearch";

import { haversineMeters, Units } from "./geo";
import { SampleStore, TrackStore } from "./track";

const SPEED_UNITS: Record<Units, { label: string; perMps: number }> = {
  metric: { label: "km/h", perMps: 3.6 },
  imperial: { label: "mph", perMps: 2.236936 },
  nautical: { label: "kn", perMps: 1.943844 },
};

export function speedUnitLabel(units: Units): string {
  return SPEED_UNITS[units].label;
}

const SPEED_WINDOW_SEC = 0.5;

/**
 * Ground speed at each fix in display units (NaN where unknown), over at least `SPEED_WINDOW_SEC` so
 * GNSS jitter between consecutive fixes doesn't dominate. The first fix takes the speed of the
 * next one.
 */
export function speedValues(track: TrackStore, units: Units): Float64Array {
  const { time, lon, lat } = track.columns;
  const values = new Float64Array(track.length);
  // Rows appended since the last call are all that's new: reuse the rest. The newest row can be
  // replaced in place while thinned, and the first takes the second's speed, so redo both.
  const cached = speedCache.get(track);
  let start = 0;
  if (
    cached?.version === track.version &&
    cached.units === units &&
    cached.values.length > 2 &&
    cached.values.length <= track.length
  ) {
    start = cached.values.length - 1;
    values.set(cached.values.subarray(0, start));
  }
  let from = Math.max(0, upperBound(time, 0, start, time[start]! - SPEED_WINDOW_SEC) - 1);
  for (let i = start; i < track.length; i++) {
    const t = time[i]!;
    // Advance `from` to the latest fix still at least `SPEED_WINDOW_SEC` back.
    while (from + 1 < i && t - time[from + 1]! >= SPEED_WINDOW_SEC) {
      from++;
    }
    const dt = t - time[from]!;
    values[i] =
      dt > 0
        ? (haversineMeters(lon[from]!, lat[from]!, lon[i]!, lat[i]!) / dt) *
          SPEED_UNITS[units].perMps
        : NaN;
  }
  if (start === 0 && values.length > 1 && isNaN(values[0]!)) {
    values[0] = values[1]!;
  }
  speedCache.set(track, { version: track.version, units, values });
  return values;
}

const speedCache = new WeakMap<
  TrackStore,
  { version: number; units: Units; values: Float64Array }
>();

/** For each fix, the latest sample at or before it (NaN if none). */
export function sampleAt(samples: SampleStore | undefined, track: TrackStore): Float64Array {
  if (!samples) {
    return new Float64Array(track.length).fill(NaN);
  }
  const { time, value } = samples.columns;
  const trackTime = track.columns.time;
  // Each flush only appends: redo the fixes from the newest cached one (it may have been replaced
  // in place) and from the first fix at or after the samples that changed, keep the rest.
  const cached = sampleCache.get(track);
  let start = 0;
  if (
    cached?.samples === samples &&
    cached.trackVersion === track.version &&
    cached.samplesVersion === samples.version &&
    cached.length <= track.length &&
    cached.samplesLength <= samples.length
  ) {
    start = Math.max(0, cached.length - 1);
    const samplesChanged =
      samples.length !== cached.samplesLength ||
      samples.tailReplacements !== cached.samplesTailReplacements;
    // From the newest cached sample's time: it may have been replaced by a later one
    if (samplesChanged && cached.samplesTailTime != undefined) {
      start = Math.min(start, lowerBound(trackTime, 0, cached.length, cached.samplesTailTime));
    }
  }
  // One buffer per track, grown by doubling: a flush doesn't allocate the whole track again
  let buffer = cached?.buffer ?? new Float64Array(0);
  if (buffer.length < track.length) {
    const grown = new Float64Array(Math.max(16, track.length * 2));
    grown.set(buffer.subarray(0, start));
    buffer = grown;
  }
  // Both are sorted by time: walk them together.
  let j = start < track.length ? upperBound(time, 0, samples.length, trackTime[start]!) - 1 : 0;
  for (let i = start; i < track.length; i++) {
    const t = trackTime[i]!;
    while (j + 1 < samples.length && time[j + 1]! <= t) {
      j++;
    }
    buffer[i] = j >= 0 ? value[j]! : NaN;
  }
  sampleCache.set(track, {
    samples,
    trackVersion: track.version,
    samplesVersion: samples.version,
    samplesLength: samples.length,
    samplesTailReplacements: samples.tailReplacements,
    samplesTailTime: samples.length > 0 ? time[samples.length - 1] : undefined,
    length: track.length,
    buffer,
  });
  return buffer.subarray(0, track.length);
}

const sampleCache = new WeakMap<
  TrackStore,
  {
    samples: SampleStore;
    trackVersion: number;
    samplesVersion: number;
    samplesLength: number;
    samplesTailReplacements: number;
    samplesTailTime: number | undefined;
    length: number;
    buffer: Float64Array;
  }
>();

/**
 * Color scale range: the given bounds, or the 2nd–98th percentile of the values so a few outliers
 * (GNSS jumps, sensor spikes) don't wash out the gradient.
 */
export function valueRange(
  values: ArrayLike<number>,
  min: number | undefined,
  max: number | undefined,
): [number, number] | undefined {
  // A percentile of an even sample is as good for a color scale, and selecting stays cheap.
  const stride = Math.max(1, Math.ceil(values.length / 100_000));
  const sample = new Float64Array(Math.ceil(values.length / stride));
  let n = 0;
  for (let i = 0; i < values.length; i += stride) {
    if (isFinite(values[i]!)) {
      sample[n++] = values[i]!;
    }
  }
  if (n === 0) {
    return undefined;
  }
  // Two selections instead of a sort: this runs on every live flush.
  const loK = Math.min(n - 1, Math.floor(0.02 * n));
  const hiK = Math.min(n - 1, Math.floor(0.98 * n));
  const lo = min ?? select(sample, loK, 0, n - 1);
  // After selecting loK, everything from loK on is >= it: the 98th percentile is in there.
  const hi = max ?? select(sample, hiK, min == undefined ? loK : 0, n - 1);
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

/** The k-th smallest of a[left..right] (quickselect), partially reordering that span. */
function select(a: Float64Array, k: number, from: number, to: number): number {
  let left = from;
  let right = to;
  while (left < right) {
    // A random pivot keeps sorted or periodic signals from hitting the quadratic case.
    const pivot = a[left + Math.floor(Math.random() * (right - left + 1))]!;
    let i = left;
    let j = right;
    while (i <= j) {
      while (a[i]! < pivot) {
        i++;
      }
      while (a[j]! > pivot) {
        j--;
      }
      if (i <= j) {
        const t = a[i]!;
        a[i] = a[j]!;
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) {
      right = j;
    } else if (k >= i) {
      left = i;
    } else {
      break;
    }
  }
  return a[k]!;
}

/** Position of a value within the range, 0..1 (clamped). */
export function normalize(value: number, [lo, hi]: [number, number]): number {
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}
