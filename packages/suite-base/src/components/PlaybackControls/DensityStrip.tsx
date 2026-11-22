// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromNanoSec, subtract, Time, toNanoSec, toSec } from "@foxglove/rostime";
import { alpha } from "@mui/material";
import React, { useMemo } from "react";
import { makeStyles } from "tss-react/mui";

import { Immutable } from "@lichtblick/suite";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  selectEndTime,
  selectRecordingFiles,
  selectStartTime,
} from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { RecordingFileInfo } from "@lichtblick/suite-base/players/types";
import { addSpan, DENSITY_BUCKETS } from "@lichtblick/suite-base/util/timelineDensity";

const useStyles = makeStyles()(({ palette }) => ({
  root: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "calc(50% + 4px)",
    height: 5,
    width: "100%",
    pointerEvents: "none",
  },
  density: { fill: alpha(palette.text.secondary, 0.55) },
  gap: { fill: alpha(palette.error.main, 0.8) },
}));

/** Message bytes of all files in DENSITY_BUCKETS equal slices of [start, end] */
export function combineDensity(
  files: readonly Immutable<RecordingFileInfo>[],
  start: Time,
  end: Time,
): Float32Array | undefined {
  const total = new Float32Array(DENSITY_BUCKETS);
  const range = toSec(subtract(end, start));
  let any = false;
  for (const file of files) {
    if (!file.messageBytes || !file.start || !file.end) {
      continue;
    }
    any = true;
    const fileStart = toSec(subtract(file.start, start));
    const width = toSec(subtract(file.end, file.start)) / file.messageBytes.length;
    file.messageBytes.forEach((bytes, i) => {
      if (bytes > 0) {
        addSpan(total, 0, range, fileStart + i * width, fileStart + (i + 1) * width, bytes);
      }
    });
  }
  return any ? total : undefined;
}

/** Slices with less than this share of the median slice's bytes count as missing data */
const GAP_SHARE = 0.05;

type Density = { buckets: Float32Array; median: number };

/** A chunk that spans a pause spreads its bytes over it: a pause is far below the median, not 0 */
export const isGap = ({ buckets, median }: Density, i: number): boolean =>
  !(buckets[i]! > 0 && buckets[i]! >= median * GAP_SHARE);

export function densityOf(buckets: Float32Array): Density {
  const sorted = buckets.filter((bytes) => bytes > 0).sort();
  return { buckets, median: sorted[Math.floor(sorted.length / 2)] ?? 0 };
}

// As values, so a player that sends equal times as new objects doesn't recompute every frame
const selectStartNs = (ctx: MessagePipelineContext) => {
  const time = selectStartTime(ctx);
  return time && toNanoSec(time);
};
const selectEndNs = (ctx: MessagePipelineContext) => {
  const time = selectEndTime(ctx);
  return time && toNanoSec(time);
};

/** The recording's message bytes over time, from the file indexes; undefined without them */
export function useDensity(): Density | undefined {
  const files = useMessagePipeline(selectRecordingFiles);
  const start = useMessagePipeline(selectStartNs);
  const end = useMessagePipeline(selectEndNs);
  return useMemo(() => {
    const buckets =
      files && start != undefined && end != undefined
        ? combineDensity(files, fromNanoSec(start), fromNanoSec(end))
        : undefined;
    return buckets && densityOf(buckets);
  }, [files, start, end]);
}

/** SVG paths: bars with the median slice at half height (capped at full), and the gaps */
export function densityPaths(density: Density): { bars: string; gaps: string } {
  const { buckets, median } = density;
  let bars = "M0 1";
  let gaps = "";
  let gapStart: number | undefined;
  buckets.forEach((bytes, i) => {
    const height = bytes > 0 ? Math.min(Math.max(bytes / (2 * median), 0.15), 1) : 0;
    bars += `V${(1 - height).toFixed(2)}H${i + 1}`;
    if (!isGap(density, i)) {
      if (gapStart != undefined) {
        gaps += `M${gapStart} 0H${i}V1H${gapStart}z`;
      }
      gapStart = undefined;
    } else {
      gapStart ??= i;
    }
  });
  if (gapStart != undefined) {
    gaps += `M${gapStart} 0H${buckets.length}V1H${gapStart}z`;
  }
  return { bars: `${bars}V1z`, gaps };
}

/** How much data the recording has over time, and where it has (almost) none */
export const DensityStrip = React.memo(function DensityStrip(): React.JSX.Element | undefined {
  const { classes } = useStyles();
  const density = useDensity();
  const paths = useMemo(() => density && densityPaths(density), [density]);

  if (!paths) {
    return undefined;
  }
  return (
    <svg
      className={classes.root}
      viewBox={`0 0 ${DENSITY_BUCKETS} 1`}
      preserveAspectRatio="none"
      data-testid="density-strip"
      aria-hidden
    >
      <path className={classes.density} d={paths.bars} />
      <path className={classes.gap} d={paths.gaps} />
    </svg>
  );
});
