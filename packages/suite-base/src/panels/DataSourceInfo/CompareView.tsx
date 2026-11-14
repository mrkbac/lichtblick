// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Chip, FormControlLabel, Switch, TextField, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Immutable } from "@lichtblick/suite";
import Stack from "@lichtblick/suite-base/components/Stack";
import TextMiddleTruncate from "@lichtblick/suite-base/components/TextMiddleTruncate";
import { RecordingFileInfo, TopicStats } from "@lichtblick/suite-base/players/types";

import { compareRecordings } from "./compareRecordings";
import { useStyles } from "./index.style";
import { TopicInspection } from "./inspection";

export function CompareView({
  files,
  topicStats,
  inspections,
}: {
  files: Immutable<RecordingFileInfo[]>;
  topicStats: ReadonlyMap<string, TopicStats> | undefined;
  inspections: ReadonlyMap<string, TopicInspection>;
}): React.JSX.Element {
  const { t } = useTranslation("dataSourceInfo");
  const { classes } = useStyles();
  const [query, setQuery] = useState("");
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const rows = useMemo(
    () => compareRecordings(files, topicStats, inspections),
    [files, topicStats, inspections],
  );
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
          placeholder={t("compareSearch")}
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
          label={t("compareOnlyDifferences", { count: differing })}
        />
      </div>
      <div className={classes.tableWrap}>
        <table className={classes.table}>
          <thead>
            <tr>
              <th>{t("compareTopic")}</th>
              {files.map((file, index) => (
                <th key={index} title={file.name}>
                  {file.topicPrefix} · <TextMiddleTruncate text={file.name ?? ""} />
                </th>
              ))}
              <th>{t("compareDiffersIn")}</th>
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
                      <span className={classes.stale}>{t("compareMissing")}</span>
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
                        label={t(`compareDifference.${difference}`)}
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
          {rows.length === 0 ? t("compareNoTopics") : t("compareNoMatch")}
        </Typography>
      )}
    </>
  );
}
