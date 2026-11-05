// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { isTypedArray } from "@lichtblick/suite-base/types/isTypedArray";

export type EnumNames = Readonly<Record<string, string>>;

const MAX_PREVIEW_ITEMS = 4;
const MAX_EXPANDED_ITEMS = 200;

/** Whether the value is shown as a short summary that can be expanded. */
export function isExpandable(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value != undefined &&
    !isTime(value) &&
    (!Array.isArray(value) || value.length > 0)
  );
}

function isTime(value: object): value is { sec: number; nsec: number } {
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    typeof (value as { sec?: unknown }).sec === "number" &&
    typeof (value as { nsec?: unknown }).nsec === "number"
  );
}

export function formatNumber(value: number, precision: number | undefined): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (precision != undefined) {
    return value.toFixed(precision);
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  const abs = Math.abs(value);
  if (abs < 1e-4 || abs >= 1e9) {
    return value.toExponential(3);
  }
  // Up to 4 decimals, without trailing zeros
  return String(Math.round(value * 1e4) / 1e4);
}

function formatScalar(
  value: unknown,
  precision: number | undefined,
  enumNames?: EnumNames,
): string {
  switch (typeof value) {
    case "number": {
      const name = enumNames?.[String(value)];
      const text = formatNumber(value, precision);
      return name != undefined ? `${name} (${text})` : text;
    }
    case "bigint": {
      const name = enumNames?.[String(value)];
      return name != undefined ? `${name} (${value})` : String(value);
    }
    case "boolean":
      return String(value);
    case "string":
      return JSON.stringify(value) ?? "";
    case "undefined":
      return "—";
    default:
      return value == undefined ? "null" : typeof value; // symbols and functions do not occur in messages
  }
}

/** One-line text for a value: scalars in full, arrays and objects as a short summary. */
export function formatValue(
  value: unknown,
  precision: number | undefined,
  enumNames?: EnumNames,
): string {
  if (typeof value !== "object" || value == undefined) {
    return formatScalar(value, precision, enumNames);
  }
  if (isTime(value)) {
    return `${value.sec}.${String(value.nsec).padStart(9, "0")}`;
  }
  if (Array.isArray(value) || isTypedArray(value)) {
    const arr = value as ArrayLike<unknown>;
    const preview = (Array.prototype.slice.call(arr, 0, MAX_PREVIEW_ITEMS) as unknown[])
      .map((item) =>
        typeof item === "object" && item != undefined ? "{…}" : formatScalar(item, precision),
      )
      .join(", ");
    const more = arr.length > MAX_PREVIEW_ITEMS ? ", …" : "";
    return `(${arr.length}) [${preview}${more}]`;
  }
  const keys = Object.keys(value);
  const shown = keys.slice(0, MAX_PREVIEW_ITEMS).join(", ");
  return `{${shown}${keys.length > MAX_PREVIEW_ITEMS ? ", …" : ""}}`;
}

/** Multi-line text for an expanded value. Long arrays are truncated to keep it cheap. */
export function formatExpanded(value: unknown, maxItems: number = MAX_EXPANDED_ITEMS): string {
  return (
    JSON.stringify(
      value,
      (_key, item: unknown) => {
        if (typeof item === "bigint") {
          return item.toString();
        }
        // JSON would turn these into null
        if (typeof item === "number" && !Number.isFinite(item)) {
          return String(item);
        }
        if (isTypedArray(item) || Array.isArray(item)) {
          const arr = item as ArrayLike<unknown>;
          if (arr.length > maxItems) {
            return [
              ...Array.prototype.slice.call(arr, 0, maxItems),
              `… ${arr.length - maxItems} more`,
            ];
          }
          return isTypedArray(item) ? Array.from(arr) : item;
        }
        return item;
      },
      2,
    ) ?? ""
  );
}

/** Full-precision text for the clipboard. */
export function copyText(value: unknown): string {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "bigint":
    case "boolean":
      return String(value);
    case "undefined":
      return "";
    default:
      return formatExpanded(value, Infinity);
  }
}

/** Numeric value for sparklines, or undefined if the value cannot be plotted. */
export function toPlottable(value: unknown): number | undefined {
  switch (typeof value) {
    case "number":
      return Number.isFinite(value) ? value : undefined;
    case "bigint":
      return Number(value);
    case "boolean":
      return value ? 1 : 0;
    default:
      return undefined;
  }
}
