// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { Immutable } from "@lichtblick/suite";
import { DeltaMarker } from "@lichtblick/suite-base/panels/shared/types";
import { customTypography } from "@lichtblick/theme";

import type { PlotCoordinator } from "./PlotCoordinator";
import { CsvDataset } from "./builders/IDatasetsBuilder";

export type RangeStat = {
  configIndex: number;
  count: number;
  min: number;
  max: number;
  mean: number;
  rms: number;
  std: number;
};

/** Statistics of each series' samples with min <= x <= max. Series without samples are left out. */
export function computeRangeStats(
  datasets: Immutable<CsvDataset[]>,
  min: number,
  max: number,
): RangeStat[] {
  const stats: RangeStat[] = [];
  for (const dataset of datasets) {
    let count = 0;
    let sum = 0;
    let sumSquares = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const { x, y } of dataset.data) {
      if (x < min || x > max || !Number.isFinite(y)) {
        continue;
      }
      count += 1;
      sum += y;
      sumSquares += y * y;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    if (count === 0) {
      continue;
    }
    const mean = sum / count;
    stats.push({
      configIndex: dataset.configIndex,
      count,
      min: lo,
      max: hi,
      mean,
      rms: Math.sqrt(sumSquares / count),
      // Population standard deviation; clamp rounding noise below zero.
      std: Math.sqrt(Math.max(0, sumSquares / count - mean * mean)),
    });
  }
  return stats;
}

/** Range statistics between the two measure markers, recomputed when a marker moves. */
export function useRangeStats(
  coordinator: PlotCoordinator | undefined,
  markerA: DeltaMarker | undefined,
  markerB: DeltaMarker | undefined,
): RangeStat[] | undefined {
  const [stats, setStats] = useState<RangeStat[] | undefined>();
  const xA = markerA?.xValue;
  const xB = markerB?.xValue;

  useEffect(() => {
    setStats(undefined);
    if (!coordinator || xA == undefined || xB == undefined) {
      return;
    }
    let cancelled = false;
    void coordinator
      .getCsvData()
      .then((datasets) => {
        if (!cancelled) {
          setStats(computeRangeStats(datasets, Math.min(xA, xB), Math.max(xA, xB)));
        }
      })
      .catch((err: unknown) => {
        console.error(err);
      });
    return () => {
      cancelled = true;
    };
  }, [coordinator, xA, xB]);

  return stats;
}

const useStyles = makeStyles()((theme) => ({
  root: {
    marginTop: theme.spacing(0.5),
    pointerEvents: "auto",
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    boxShadow: theme.shadows[4],
    padding: theme.spacing(1, 1.5),
    opacity: 0.95,
    display: "grid",
    gridTemplateColumns: "max-content repeat(6, max-content)",
    columnGap: theme.spacing(1.5),
    rowGap: theme.spacing(0.25),
    fontFamily: customTypography.fontMonospace,
    fontSize: theme.typography.caption.fontSize,
    lineHeight: theme.typography.caption.lineHeight,
  },
  header: {
    opacity: 0.8,
    textAlign: "right",
  },
  label: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.75),
    maxWidth: 200,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  value: {
    textAlign: "right",
    whiteSpace: "nowrap",
  },
}));

const formatStat = (value: number) =>
  Math.abs(value) >= 1e5 || (value !== 0 && Math.abs(value) < 1e-3)
    ? value.toExponential(3)
    : value.toFixed(4);

export function RangeStatsTable({
  stats,
  labelsByConfigIndex,
  colorsByConfigIndex,
}: {
  stats: RangeStat[];
  labelsByConfigIndex: Record<string, string>;
  colorsByConfigIndex: Record<string, string>;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("plot");
  const columns = [t("count"), t("min"), t("max"), t("mean"), t("rms"), t("stdDev")];

  return (
    <div className={classes.root} data-testid="plot-range-stats">
      <div />
      {columns.map((column) => (
        <div key={column} className={classes.header}>
          {column}
        </div>
      ))}
      {stats.map((stat) => (
        <Fragment key={stat.configIndex}>
          <div className={classes.label} title={labelsByConfigIndex[stat.configIndex]}>
            <span
              className={classes.dot}
              style={{ backgroundColor: colorsByConfigIndex[stat.configIndex] }}
            />
            {labelsByConfigIndex[stat.configIndex]}
          </div>
          <div className={classes.value}>{stat.count}</div>
          {[stat.min, stat.max, stat.mean, stat.rms, stat.std].map((value, idx) => (
            <div key={idx} className={classes.value}>
              {formatStat(value)}
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
