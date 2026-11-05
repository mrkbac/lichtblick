// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromSec } from "@foxglove/rostime";
import { Tooltip, useTheme } from "@mui/material";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { useAppTimeFormat } from "@lichtblick/suite-base/hooks";
import {
  LEVEL_NAMES,
  LEVELS,
  TIMELINE_BUCKETS,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import {
  CheckHistory,
  levelAt,
  toTimelineRuns,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/history";

const useStyles = makeStyles()((theme) => ({
  root: {
    position: "relative",
    flex: "none",
    height: 12,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: theme.palette.action.hover,
    cursor: "pointer",
  },
  svg: { display: "block", width: "100%", height: "100%" },
  playhead: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: theme.palette.text.primary,
    pointerEvents: "none",
  },
}));

export type DiagnosticTimelineProps = {
  history: CheckHistory | undefined;
  /** Data source start, end and playback position, all in seconds. */
  start: number;
  end: number;
  current: number | undefined;
  staleSec: number;
  width: number | string;
  onSeek?: (seconds: number) => void;
};

/** Status of one check over time: one colored run per level, worst level wins per pixel. */
function DiagnosticTimeline(props: DiagnosticTimelineProps): React.JSX.Element {
  const { history, start, end, current, staleSec, width, onSeek } = props;
  const { classes } = useStyles();
  const theme = useTheme();
  const { t } = useTranslation("diagnostics");
  const { formatTime } = useAppTimeFormat();
  const [hoverTime, setHoverTime] = useState<number>();

  const colors: Record<number, string> = {
    [LEVELS.OK]: theme.palette.success.main,
    [LEVELS.WARN]: theme.palette.warning.main,
    [LEVELS.ERROR]: theme.palette.error.main,
    [LEVELS.STALE]: theme.palette.text.disabled,
  };

  const runs = useMemo(
    () => (history ? toTimelineRuns(history, start, end, TIMELINE_BUCKETS, staleSec) : []),
    [history, start, end, staleSec],
  );

  const span = end - start;
  const timeAt = (event: React.MouseEvent<HTMLElement>) => {
    const { left, width: w } = event.currentTarget.getBoundingClientRect();
    return start + (w > 0 ? ((event.clientX - left) / w) * span : 0);
  };

  let tooltip = "";
  if (hoverTime != undefined) {
    const level = history ? levelAt(history, hoverTime, staleSec) : undefined;
    const levelName = level ? LEVEL_NAMES[level.level]?.toUpperCase() : undefined;
    tooltip = `${levelName ? `${levelName} · ` : ""}${formatTime(fromSec(hoverTime))}`;
    if (onSeek) {
      tooltip += ` · ${t("clickToSeek")}`;
    }
  }

  const playhead =
    current != undefined && span > 0 && current >= start && current <= end
      ? `${((current - start) / span) * 100}%`
      : undefined;

  return (
    <Tooltip title={tooltip} followCursor disableInteractive placement="top">
      <div
        className={classes.root}
        style={{ width }}
        data-testid="diagnostic-timeline"
        onMouseMove={(event) => {
          setHoverTime(timeAt(event));
        }}
        onMouseLeave={() => {
          setHoverTime(undefined);
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (onSeek && span > 0) {
            onSeek(timeAt(event));
          }
        }}
      >
        <svg
          className={classes.svg}
          viewBox={`0 0 ${TIMELINE_BUCKETS} 1`}
          preserveAspectRatio="none"
        >
          {runs.map((run) => (
            <rect
              key={run.x}
              x={run.x}
              width={run.w}
              height={1}
              fill={colors[run.level] ?? theme.palette.text.disabled}
            />
          ))}
        </svg>
        {playhead != undefined && <div className={classes.playhead} style={{ left: playhead }} />}
      </div>
    </Tooltip>
  );
}

export default React.memo(DiagnosticTimeline);
