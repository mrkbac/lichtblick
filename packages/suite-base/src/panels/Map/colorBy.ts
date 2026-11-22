// SPDX-License-Identifier: MPL-2.0

import { distanceMeters, Units } from "./geo";
import { SampleStore, TrackStore } from "./track";

const SPEED_UNITS: Record<Units, { label: string; perMps: number }> = {
  metric: { label: "km/h", perMps: 3.6 },
  imperial: { label: "mph", perMps: 2.236936 },
  nautical: { label: "kn", perMps: 1.943844 },
};

export function speedUnitLabel(units: Units): string {
  return SPEED_UNITS[units].label;
}

/**
 * Ground speed at each fix in display units (NaN where unknown), over at least `windowSeconds` so
 * GNSS jitter between consecutive fixes doesn't dominate. The first fix takes the speed of the
 * next one.
 */
export function speedValues(track: TrackStore, units: Units, windowSeconds = 0.5): Float64Array {
  const { time } = track.columns;
  const values = new Float64Array(track.length);
  let from = 0;
  for (let i = 0; i < track.length; i++) {
    const t = time[i]!;
    // Advance `from` to the latest fix still at least `windowSeconds` back.
    while (from + 1 < i && t - time[from + 1]! >= windowSeconds) {
      from++;
    }
    const dt = t - time[from]!;
    values[i] =
      dt > 0
        ? (distanceMeters(track.lngLat(from), track.lngLat(i)) / dt) * SPEED_UNITS[units].perMps
        : NaN;
  }
  if (values.length > 1 && isNaN(values[0]!)) {
    values[0] = values[1]!;
  }
  return values;
}

/** For each fix, the latest sample at or before it (NaN if none). */
export function sampleAt(samples: SampleStore | undefined, track: TrackStore): Float64Array {
  const values = new Float64Array(track.length).fill(NaN);
  if (!samples) {
    return values;
  }
  const { time, value } = samples.columns;
  // Both are sorted by time: walk them together.
  let j = -1;
  for (let i = 0; i < track.length; i++) {
    const t = track.columns.time[i]!;
    while (j + 1 < samples.length && time[j + 1]! <= t) {
      j++;
    }
    if (j >= 0) {
      values[i] = value[j]!;
    }
  }
  return values;
}

/**
 * Color scale range: the given bounds, or the 2nd–98th percentile of the values so a few outliers
 * (GNSS jumps, sensor spikes) don't wash out the gradient.
 */
export function valueRange(
  values: ArrayLike<number>,
  min: number | undefined,
  max: number | undefined,
): [number, number] | undefined {
  const sorted = Float64Array.from(values).filter(isFinite).sort();
  if (sorted.length === 0) {
    return undefined;
  }
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const lo = min ?? at(0.02);
  const hi = max ?? at(0.98);
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

/** Position of a value within the range, 0..1 (clamped). */
export function normalize(value: number, [lo, hi]: [number, number]): number {
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}
