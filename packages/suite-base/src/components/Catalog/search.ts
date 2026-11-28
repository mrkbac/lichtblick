// SPDX-License-Identifier: MPL-2.0

import { toSec } from "@foxglove/rostime";
import * as _ from "lodash-es";

import * as Foxglove from "@lichtblick/suite-base/panels/ThreeDeeRender/foxglove";
import * as Ros from "@lichtblick/suite-base/panels/ThreeDeeRender/ros";
import {
  guessTimezone,
  instantOfWallTime,
  parseTimeStr,
} from "@lichtblick/suite-base/util/formatTime";
import { COMPRESSED_VIDEO_DATATYPES } from "@lichtblick/suite-base/util/foxgloveSchemas";

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

/** Text that free search matches: name, path and, for live recordings, the machine. */
function searchText(recording: CatalogRecording): string {
  return [recording.name, sourceText(recording), recording.machine ?? ""].join("\n").toLowerCase();
}

function durationSec(recording: CatalogRecording): number | undefined {
  return recording.start && recording.end
    ? toSec(recording.end) - toSec(recording.start)
    : undefined;
}

/** `has:` kinds, by the schemas of their topics, so they work whatever the topics are called. */
const KIND_SCHEMAS: Record<string, readonly ReadonlySet<string>[]> = {
  image: [
    Ros.IMAGE_DATATYPES,
    Ros.COMPRESSED_IMAGE_DATATYPES,
    Foxglove.RAW_IMAGE_DATATYPES,
    Foxglove.COMPRESSED_IMAGE_DATATYPES,
  ],
  pointcloud: [Ros.POINTCLOUD_DATATYPES, Foxglove.POINTCLOUD_DATATYPES],
  tf: [Ros.TF_DATATYPES, Foxglove.FRAME_TRANSFORM_DATATYPES, Foxglove.FRAME_TRANSFORMS_DATATYPES],
  video: [COMPRESSED_VIDEO_DATATYPES],
};

function hasPredicate(kind: string): Predicate | undefined {
  if (kind === "gps") {
    return (r) => (r.tracks?.length ?? 0) > 0;
  }
  const schemas = KIND_SCHEMAS[kind];
  return schemas
    ? (r) => r.topics?.some((t) => schemas.some((set) => set.has(t.schema))) ?? false
    : undefined;
}

function statusPredicate(status: string): Predicate | undefined {
  switch (status) {
    case "error":
      return (r) => r.error != undefined;
    case "nosummary":
      return (r) => r.noSummary === true;
    case "ok":
      return (r) => r.error == undefined && r.noSummary !== true;
  }
  return undefined;
}

/** `a|b` matches either; every alternative must be valid. */
function anyOf(needle: string, predicate: (value: string) => Predicate | undefined) {
  const predicates = needle.split("|").map(predicate);
  if (predicates.some((p) => p == undefined)) {
    return undefined;
  }
  return (r: CatalogRecording) => predicates.some((p) => p!(r));
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const PERIOD = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2})(?:T(\d{1,2}):(\d{2})(?::(\d{2}))?)?)?)?$/;

/**
 * The span a date names, in ms: `2026` is the whole year, `2026-11-27` the whole day and
 * `2026-11-27T08:30` that minute, as wall time in `timezone`, with `end` exclusive (the next
 * period's start). A time with an explicit offset (`…Z`, `…+01:00`) is that instant, `end`
 * inclusive.
 */
export function parsePeriod(
  value: string,
  timezone?: string,
): { start: number; end: number; endInclusive: boolean } | undefined {
  const m = PERIOD.exec(value);
  if (!m) {
    // Only an instant with an explicit offset: anything else Date.parse reads in the browser's zone
    // (not `timezone`) or guesses (`5` is May 2001)
    if (!INSTANT.test(value)) {
      return undefined;
    }
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : { start: ms, end: ms, endInclusive: true };
  }
  const fields = (m.slice(1) as (string | undefined)[]).map((field) =>
    field == undefined ? undefined : Number(field),
  );
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0] = fields;
  const pad = (n: number) => String(n).padStart(2, "0");
  // parseTimeStr rejects dates that don't exist (Feb 30) and resolves the wall time in the zone
  const start = parseTimeStr(
    `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`,
    timezone,
  );
  if (!start) {
    return undefined;
  }
  // The next period starts one unit of the last field given later; Date.UTC rolls it over
  const next = [year, month - 1, day, hour, minute, second];
  next[fields.findLastIndex((field) => field != undefined)]! += 1;
  const nextWall = Date.UTC(next[0]!, next[1], next[2], next[3], next[4], next[5]);
  return {
    start: toSec(start) * 1000,
    end: instantOfWallTime(nextWall, timezone ?? guessTimezone()),
    endInclusive: false,
  };
}

function filterPredicate(
  key: string,
  op: string,
  value: string,
  timezone: string | undefined,
): Predicate | undefined {
  const needle = value.toLowerCase();
  switch (key) {
    case "topic":
      return (r) => r.topics?.some((t) => t.name.toLowerCase().includes(needle)) ?? false;
    case "schema":
      return (r) => r.topics?.some((t) => t.schema.toLowerCase().includes(needle)) ?? false;
    case "path":
      return (r) => sourceText(r).toLowerCase().includes(needle);
    case "machine":
      // `machine:robot` matches part of the name, `machine=robot-1` the whole name.
      return op === "="
        ? (r) => r.machine?.toLowerCase() === needle
        : op === ":"
          ? (r) => r.machine?.toLowerCase().includes(needle) ?? false
          : undefined;
    case "since":
    case "until": {
      const period = op === ":" ? parsePeriod(value, timezone) : undefined;
      if (!period) {
        return undefined;
      }
      // `until:2026-11-27` keeps recordings from any instant of that day
      return key === "since"
        ? (r) => r.end != undefined && toSec(r.end) * 1000 >= period.start
        : period.endInclusive
          ? (r) => r.start != undefined && toSec(r.start) * 1000 <= period.end
          : (r) => r.start != undefined && toSec(r.start) * 1000 < period.end;
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
      return op === ":" ? anyOf(needle, statusPredicate) : undefined;
    case "has":
      return op === ":" ? anyOf(needle, hasPredicate) : undefined;
  }
  return undefined;
}

/**
 * Filter recordings with a query of space-separated terms, all of which must match:
 * free text (name, path or machine), `topic:`, `schema:`, `path:`, `machine:` (or exact `machine=`),
 * `since:`/`until:` (dates),
 * `duration>5m`, `size<2GB`, `status:error|nosummary|ok` and `has:image|gps|pointcloud|tf|video`
 * (`|` matches either). Unknown filters match as text.
 */
export function filterRecordings(
  recordings: readonly CatalogRecording[],
  query: string,
  /** Wall-clock dates in the query are in this zone (the app setting); default: the system's */
  timezone?: string,
): CatalogRecording[] {
  const predicates: Predicate[] = [];
  for (const term of query.trim().split(/\s+/).filter(Boolean)) {
    const match = /^([a-z]+)([:<>=])(.+)$/i.exec(term);
    const predicate = match
      ? filterPredicate(match[1]!.toLowerCase(), match[2]!, match[3]!, timezone)
      : undefined;
    if (predicate) {
      predicates.push(predicate);
      continue;
    }
    const needle = term.toLowerCase();
    predicates.push((r) => searchText(r).includes(needle));
  }
  return recordings.filter((r) => predicates.every((predicate) => predicate(r)));
}

export type SortKey = "name" | "start" | "duration" | "size" | "messages" | "topics";
export type CatalogSort = { key: SortKey; desc: boolean };
export const DEFAULT_CATALOG_SORT: CatalogSort = { key: "start", desc: true };

const SORT_VALUES: Record<SortKey, (r: CatalogRecording) => string | number | undefined> = {
  name: (r) => r.name.toLowerCase(),
  start: (r) => (r.start ? toSec(r.start) : undefined),
  duration: durationSec,
  size: (r) => r.size,
  messages: (r) => r.messages,
  topics: (r) => r.topics?.length,
};

export function sortRecordings(
  recordings: CatalogRecording[],
  { key, desc }: CatalogSort,
): CatalogRecording[] {
  const value = SORT_VALUES[key];
  const [known, unknown] = _.partition(recordings, (r) => value(r) != undefined);
  const sorted = _.sortBy(known, value);
  return [...(desc ? sorted.reverse() : sorted), ...unknown];
}
