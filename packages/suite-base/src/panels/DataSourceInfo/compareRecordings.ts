// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time, subtract, toSec } from "@foxglove/rostime";

import { Immutable } from "@lichtblick/suite";
import { RecordingFileInfo, TopicStats } from "@lichtblick/suite-base/players/types";

import { TopicInspection } from "./inspection";

export type CompareCell = {
  count?: number;
  hz?: number;
  /** All schema names the recording uses for this topic, sorted and comma-joined */
  schemaName?: string;
};
export type CompareDifference = "missing" | "schema" | "rate";
export type CompareRow = {
  /** Topic name without the recording prefix */
  topic: string;
  /** One cell per recording, undefined when that recording lacks the topic */
  cells: (CompareCell | undefined)[];
  differences: CompareDifference[];
};

// Rates within 10% of each other count as the same: recordings rarely run at exactly equal Hz.
const RATE_TOLERANCE = 1.1;

type RateCandidates = Omit<CompareCell, "hz"> & {
  median?: number;
  span?: number;
  average?: number;
};
const RATE_BASES = ["median", "span", "average"] as const;

function span(first: Time | undefined, last: Time | undefined): number {
  return first && last ? toSec(subtract(last, first)) : 0;
}

/**
 * Lines up each topic across compared recordings and flags what differs.
 *
 * Every row compares rates on one basis, the first that all of its recordings have: the median
 * rate from a scan of the topic, the rate between the topic's first and last message, or its count
 * over the recording's duration (indexed MCAP summaries only carry counts).
 */
export function compareRecordings(
  files: Immutable<RecordingFileInfo[]>,
  topicStats: ReadonlyMap<string, TopicStats> | undefined,
  inspections?: ReadonlyMap<string, TopicInspection>,
): CompareRow[] {
  const rows = new Map<string, (RateCandidates | undefined)[]>();
  files.forEach((file, index) => {
    const prefix = file.topicPrefix ?? "";
    const schemasByTopic = new Map<string, Set<string>>();
    for (const channel of file.channels) {
      if (!channel.topic.startsWith(prefix)) {
        continue;
      }
      const schemas = schemasByTopic.get(channel.topic) ?? new Set();
      schemas.add(channel.schemaName ?? "");
      schemasByTopic.set(channel.topic, schemas);
    }
    const fileSeconds = span(file.start, file.end);
    for (const [prefixedTopic, schemas] of schemasByTopic) {
      const topic = prefixedTopic.slice(prefix.length);
      const stats = topicStats?.get(prefixedTopic);
      const inspection = inspections?.get(prefixedTopic);
      const count = inspection?.count ?? stats?.numMessages;
      const topicSeconds = span(stats?.firstMessageTime, stats?.lastMessageTime);
      const cells =
        rows.get(topic) ?? new Array<RateCandidates | undefined>(files.length).fill(undefined);
      cells[index] = {
        count,
        schemaName: [...schemas].sort().join(", "),
        median: inspection?.timing?.medianHz,
        span:
          count != undefined && count > 1 && topicSeconds > 0
            ? (count - 1) / topicSeconds
            : undefined,
        average: count != undefined && fileSeconds > 0 ? count / fileSeconds : undefined,
      };
      rows.set(topic, cells);
    }
  });
  return [...rows]
    .map(([topic, candidates]) => {
      const basis = RATE_BASES.find((key) =>
        candidates.every((cell) => cell == undefined || cell[key] != undefined),
      );
      const cells = candidates.map(
        (cell): CompareCell | undefined =>
          cell && {
            count: cell.count,
            schemaName: cell.schemaName,
            hz: basis && cell[basis],
          },
      );
      const present = cells.filter((cell): cell is CompareCell => cell != undefined);
      const rates = present.flatMap((cell) => (cell.hz != undefined ? [cell.hz] : []));
      const differences: CompareDifference[] = [];
      if (present.length < cells.length) {
        differences.push("missing");
      }
      if (new Set(present.map((cell) => cell.schemaName)).size > 1) {
        differences.push("schema");
      }
      if (rates.length > 1 && Math.max(...rates) > Math.min(...rates) * RATE_TOLERANCE) {
        differences.push("rate");
      }
      return { topic, cells, differences };
    })
    .sort((a, b) => {
      const differs = Number(b.differences.length > 0) - Number(a.differences.length > 0);
      return differs !== 0 ? differs : a.topic.localeCompare(b.topic);
    });
}
