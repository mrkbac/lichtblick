// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { toSec } from "@foxglove/rostime";

import { CatalogRecording } from "./types";

type Predicate = (recording: CatalogRecording) => boolean;

const DURATION_UNITS: Record<string, number> = { "": 1, s: 1, m: 60, min: 60, h: 3600, d: 86400 };
const SIZE_UNITS: Record<string, number> = {
  "": 1,
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
};

function parseAmount(value: string, units: Record<string, number>): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(value);
  const unit = match ? units[match[2]!.toLowerCase()] : undefined;
  return match && unit != undefined ? Number(match[1]) * unit : undefined;
}

function compare(op: string, actual: number | undefined, expected: number): boolean {
  if (actual == undefined) {
    return false;
  }
  return op === ">" ? actual > expected : op === "<" ? actual < expected : actual === expected;
}

function sourceText(recording: CatalogRecording): string {
  return recording.source.type === "local-file" ? recording.source.path : recording.source.url;
}

function durationSec(recording: CatalogRecording): number | undefined {
  return recording.start && recording.end
    ? toSec(recording.end) - toSec(recording.start)
    : undefined;
}

function filterPredicate(key: string, op: string, value: string): Predicate | undefined {
  const needle = value.toLowerCase();
  switch (key) {
    case "topic":
      return (r) => r.topics?.some((t) => t.name.toLowerCase().includes(needle)) ?? false;
    case "schema":
      return (r) => r.topics?.some((t) => t.schema.toLowerCase().includes(needle)) ?? false;
    case "path":
      return (r) => sourceText(r).toLowerCase().includes(needle);
    case "since":
    case "until": {
      const ms = Date.parse(value);
      if (Number.isNaN(ms) || op !== ":") {
        return undefined;
      }
      return key === "since"
        ? (r) => r.end != undefined && toSec(r.end) * 1000 >= ms
        : (r) => r.start != undefined && toSec(r.start) * 1000 <= ms;
    }
    case "duration": {
      const sec = parseAmount(value, DURATION_UNITS);
      return sec == undefined ? undefined : (r) => compare(op, durationSec(r), sec);
    }
    case "size": {
      const bytes = parseAmount(value, SIZE_UNITS);
      return bytes == undefined ? undefined : (r) => compare(op, r.size, bytes);
    }
    case "status":
      switch (needle) {
        case "error":
          return (r) => r.error != undefined;
        case "nosummary":
          return (r) => r.noSummary === true;
        case "ok":
          return (r) => r.error == undefined && r.noSummary !== true;
      }
      return undefined;
  }
  return undefined;
}

/**
 * Filter recordings with a query of space-separated terms, all of which must match:
 * free text (name or path), `topic:`, `schema:`, `path:`, `since:`/`until:` (dates),
 * `duration>5m`, `size<2GB` and `status:error|nosummary|ok`. Unknown filters match as text.
 */
export function filterRecordings(
  recordings: readonly CatalogRecording[],
  query: string,
): CatalogRecording[] {
  const predicates: Predicate[] = [];
  for (const term of query.trim().split(/\s+/).filter(Boolean)) {
    const match = /^([a-z]+)([:<>])(.+)$/i.exec(term);
    const predicate = match
      ? filterPredicate(match[1]!.toLowerCase(), match[2]!, match[3]!)
      : undefined;
    if (predicate) {
      predicates.push(predicate);
      continue;
    }
    const needle = term.toLowerCase();
    predicates.push(
      (r) => r.name.toLowerCase().includes(needle) || sourceText(r).toLowerCase().includes(needle),
    );
  }
  return recordings.filter((r) => predicates.every((predicate) => predicate(r)));
}
