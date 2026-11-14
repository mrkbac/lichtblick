// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { subtract, toSec } from "@foxglove/rostime";
import { Chip, FormControlLabel, Switch, TextField, Typography } from "@mui/material";
import { useMemo, useState } from "react";

import { Immutable } from "@lichtblick/suite";
import Stack from "@lichtblick/suite-base/components/Stack";
import TextMiddleTruncate from "@lichtblick/suite-base/components/TextMiddleTruncate";
import { RecordingFileInfo, TopicStats } from "@lichtblick/suite-base/players/types";

import { useStyles } from "./index.style";

export type CompareCell = { count?: number; hz?: number; schemaName?: string };
export type CompareRow = {
  /** Topic name without the recording prefix */
  topic: string;
  /** One cell per recording, undefined when that recording lacks the topic */
  cells: (CompareCell | undefined)[];
  differences: ("missing" | "schema" | "rate")[];
};

// Rates within 10% of each other count as the same: recordings rarely run at exactly equal Hz.
const RATE_TOLERANCE = 1.1;

/** Lines up each topic across compared recordings and flags what differs. */
export function compareRecordings(
  files: Immutable<RecordingFileInfo[]>,
  topicStats: ReadonlyMap<string, TopicStats> | undefined,
): CompareRow[] {
  const rows = new Map<string, (CompareCell | undefined)[]>();
  files.forEach((file, index) => {
    const prefix = file.topicPrefix ?? "";
    for (const channel of file.channels) {
      const topic = channel.topic.startsWith(prefix) ? channel.topic.slice(prefix.length) : "";
      const stats = topicStats?.get(channel.topic);
      const span =
        stats?.firstMessageTime && stats.lastMessageTime
          ? toSec(subtract(stats.lastMessageTime, stats.firstMessageTime))
          : 0;
      const cells =
        rows.get(topic) ?? new Array<CompareCell | undefined>(files.length).fill(undefined);
      cells[index] = {
        count: stats?.numMessages,
        hz: stats && stats.numMessages > 1 && span > 0 ? (stats.numMessages - 1) / span : undefined,
        schemaName: channel.schemaName,
      };
      rows.set(topic, cells);
    }
  });
  return [...rows]
    .map(([topic, cells]) => {
      const present = cells.filter((cell): cell is CompareCell => cell != undefined);
      const rates = present.flatMap((cell) => (cell.hz != undefined ? [cell.hz] : []));
      const differences: CompareRow["differences"] = [];
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

export function CompareView({
  files,
  topicStats,
}: {
  files: Immutable<RecordingFileInfo[]>;
  topicStats: ReadonlyMap<string, TopicStats> | undefined;
}): React.JSX.Element {
  const { classes } = useStyles();
  const [query, setQuery] = useState("");
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const rows = useMemo(() => compareRecordings(files, topicStats), [files, topicStats]);
  const differing = rows.filter((row) => row.differences.length > 0).length;
  const shown = rows.filter(
    (row) =>
      (!onlyDifferences || row.differences.length > 0) &&
      row.topic.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <>
      <div className={classes.controls}>
        <TextField
          size="small"
          className={classes.search}
          placeholder="Search topics…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={onlyDifferences}
              onChange={(_event, checked) => {
                setOnlyDifferences(checked);
              }}
            />
          }
          label={`Only differences (${differing})`}
        />
      </div>
      <div className={classes.tableWrap}>
        <table className={classes.table}>
          <thead>
            <tr>
              <th>Topic</th>
              {files.map((file, index) => (
                <th key={index} title={file.name}>
                  {file.topicPrefix} · <TextMiddleTruncate text={file.name ?? ""} />
                </th>
              ))}
              <th>Differs in</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.topic}>
                <td className={classes.topic}>
                  <code>{row.topic}</code>
                </td>
                {row.cells.map((cell, index) => (
                  <td key={index} className={classes.numeric}>
                    {cell ? (
                      <>
                        <span className={classes.count}>{cell.count?.toLocaleString() ?? "—"}</span>{" "}
                        <span className={classes.rate}>
                          {cell.hz != undefined ? `${cell.hz.toFixed(1)} Hz` : ""}
                        </span>
                        {row.differences.includes("schema") && (
                          <span className={classes.schemaLabel}>{cell.schemaName ?? "—"}</span>
                        )}
                      </>
                    ) : (
                      <span className={classes.stale}>missing</span>
                    )}
                  </td>
                ))}
                <td>
                  <Stack direction="row" gap={0.5}>
                    {row.differences.map((difference) => (
                      <Chip
                        key={difference}
                        size="small"
                        color="warning"
                        variant="outlined"
                        label={difference}
                      />
                    ))}
                  </Stack>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && (
        <Typography color="textSecondary" className={classes.emptyNoteY}>
          {rows.length === 0 ? "Topic comparison needs indexed MCAP files." : "No topics match."}
        </Typography>
      )}
    </>
  );
}
