// SPDX-License-Identifier: MPL-2.0

import { GaugeConfig } from "./types";

/** A numeric reading from a number or numeric string; NaN for anything else, including "". */
export function toNumber(value: unknown): number {
  return typeof value === "number" || (typeof value === "string" && value.trim() !== "")
    ? Number(value)
    : NaN;
}

const finite = (v: number | undefined): v is number => v != undefined && Number.isFinite(v);

/** Min/max limits, or undefined when a field is cleared or max is not above min. */
export function validLimits({
  minValue,
  maxValue,
}: Pick<GaugeConfig, "minValue" | "maxValue">): { min: number; max: number } | undefined {
  return finite(minValue) && finite(maxValue) && maxValue > minValue
    ? { min: minValue, max: maxValue }
    : undefined;
}

/** Inclinometer thresholds, or undefined unless 0 < warning < critical < range ≤ 90. */
export function validAngles({
  angleRange,
  warningAngle,
  criticalAngle,
}: Pick<GaugeConfig, "angleRange" | "warningAngle" | "criticalAngle">):
  | { range: number; warning: number; critical: number }
  | undefined {
  return finite(angleRange) &&
    finite(warningAngle) &&
    finite(criticalAngle) &&
    warningAngle > 0 &&
    criticalAngle > warningAngle &&
    angleRange > criticalAngle &&
    angleRange <= 90
    ? { range: angleRange, warning: warningAngle, critical: criticalAngle }
    : undefined;
}

/**
 * A live reading with a fixed number of decimals for its size (2 below 10, 1 below 100, none
 * above), so trailing zeros stay and the number doesn't jump around as the value changes.
 */
export function formatReading(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
