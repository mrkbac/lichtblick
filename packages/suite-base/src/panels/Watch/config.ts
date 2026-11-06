// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";

export type WatchRow = {
  id: string;
  /** Message path, e.g. `/odom.twist.twist.linear.x.@mul(3.6)` */
  path: string;
  label?: string;
  /** Fixed number of decimals; automatic when unset */
  precision?: number;
  unit?: string;
  /** Overrides the panel's `staleAfterSec` for this row */
  staleAfterSec?: number;
};

export type WatchConfig = {
  rows: WatchRow[];
  /** Show a sparkline of recent numeric values next to each row */
  sparklines: boolean;
  /** Show how long ago each value's message arrived */
  showAge: boolean;
  /** Values older than this many seconds are shown as stale */
  staleAfterSec: number;
};

export const DEFAULT_CONFIG: WatchConfig = {
  rows: [],
  sparklines: true,
  showAge: true,
  staleAfterSec: 2,
};

/** A positive number of seconds, or undefined. */
export const validStaleAfter = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

export function newRow(path: string): WatchRow {
  return { id: randomUUID(), path };
}

/** Split pasted text into message paths, one per line. */
export function parsePastedPaths(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Accept any saved config (older versions, hand-edited layouts) and return a valid one. */
export function migrateConfig(raw: unknown): WatchConfig {
  const input = (typeof raw === "object" && raw != undefined ? raw : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const rows: WatchRow[] = [];
  for (const item of Array.isArray(input.rows) ? (input.rows as unknown[]) : []) {
    // Plain strings are accepted as paths
    const candidate = typeof item === "string" ? { path: item } : item;
    if (typeof candidate !== "object" || candidate == undefined) {
      continue; // also rejects `null`
    }
    const obj = candidate as Record<string, unknown>;
    if (typeof obj.path !== "string") {
      continue;
    }
    let id = optionalString(obj.id) ?? randomUUID();
    if (seen.has(id)) {
      id = randomUUID();
    }
    seen.add(id);
    const precision = obj.precision;
    rows.push({
      id,
      path: obj.path,
      label: optionalString(obj.label),
      precision:
        typeof precision === "number" && Number.isInteger(precision) && precision >= 0
          ? Math.min(precision, 15)
          : undefined,
      unit: optionalString(obj.unit),
      staleAfterSec: validStaleAfter(obj.staleAfterSec),
    });
  }
  return {
    rows,
    sparklines:
      typeof input.sparklines === "boolean" ? input.sparklines : DEFAULT_CONFIG.sparklines,
    showAge: typeof input.showAge === "boolean" ? input.showAge : DEFAULT_CONFIG.showAge,
    staleAfterSec: validStaleAfter(input.staleAfterSec) ?? DEFAULT_CONFIG.staleAfterSec,
  };
}
