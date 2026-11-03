// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";

import { distanceMeters, LngLat, Units } from "./geo";

/** A numeric value at a time (seconds), e.g. from a message path on another topic. */
export type Sample = { time: number; value: number };

const SPEED_UNITS: Record<Units, { label: string; perMps: number }> = {
  metric: { label: "km/h", perMps: 3.6 },
  imperial: { label: "mph", perMps: 2.236936 },
  nautical: { label: "kn", perMps: 1.943844 },
};

export function speedUnitLabel(units: Units): string {
  return SPEED_UNITS[units].label;
}

/**
 * Ground speed at each fix in display units, over at least `windowSeconds` so GNSS jitter between
 * consecutive fixes doesn't dominate. The first fix takes the speed of the next one.
 */
export function speedValues(
  fixes: readonly { time: number; position: LngLat }[],
  units: Units,
  windowSeconds = 0.5,
): (number | undefined)[] {
  const values: (number | undefined)[] = [];
  let from = 0;
  for (let i = 0; i < fixes.length; i++) {
    const current = fixes[i]!;
    // Advance `from` to the latest fix still at least `windowSeconds` back.
    while (from + 1 < i && current.time - fixes[from + 1]!.time >= windowSeconds) {
      from++;
    }
    const start = fixes[from]!;
    const dt = current.time - start.time;
    values.push(
      dt > 0
        ? (distanceMeters(start.position, current.position) / dt) * SPEED_UNITS[units].perMps
        : undefined,
    );
  }
  if (values.length > 1 && values[0] == undefined) {
    values[0] = values[1];
  }
  return values;
}

/** For each time, the latest sample at or before it (samples sorted by time). */
export function sampleAt(
  samples: readonly Sample[],
  times: readonly number[],
): (number | undefined)[] {
  return times.map((time) => {
    const index = _.sortedLastIndexBy(samples, { time, value: 0 }, (s) => s.time) - 1;
    return samples[index]?.value;
  });
}

/**
 * Color scale range: the given bounds, or the 2nd–98th percentile of the values so a few outliers
 * (GNSS jumps, sensor spikes) don't wash out the gradient.
 */
export function valueRange(
  values: readonly (number | undefined)[],
  min: number | undefined,
  max: number | undefined,
): [number, number] | undefined {
  const sorted = values
    .filter((v): v is number => v != undefined && isFinite(v))
    .sort((a, b) => a - b);
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
