// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Tooltip } from "@mui/material";
import { makeStyles } from "tss-react/mui";

import { formatByteSize } from "@lichtblick/den/format";
import { subtract } from "@lichtblick/rostime";
import { format, formatDuration } from "@lichtblick/suite-base/util/formatTime";
import { formatTimeRaw, isAbsoluteTime } from "@lichtblick/suite-base/util/time";

import { AnimatedThumbnail } from "./AnimatedThumbnail";
import { CatalogRecording } from "./types";

export const THUMB_WIDTH = 72;

const useStyles = makeStyles()((theme) => ({
  thumbnail: {
    flexShrink: 0,
    width: THUMB_WIDTH,
    height: (THUMB_WIDTH * 9) / 16,
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.action.hover,
  },
  preview: {
    width: 480,
    aspectRatio: "16 / 9",
  },
  previewTooltip: {
    maxWidth: "none",
    padding: theme.spacing(0.5),
  },
}));

export function formatStart(r: CatalogRecording): string {
  if (!r.start) {
    return "–";
  }
  return isAbsoluteTime(r.start) ? format(r.start) : formatTimeRaw(r.start);
}

/** "start · duration · size", leaving out what isn't known. */
export function recordingCaption(r: CatalogRecording): string {
  return [
    formatStart(r),
    r.start && r.end ? formatDuration(subtract(r.end, r.start)) : undefined,
    r.size != undefined ? formatByteSize(r.size) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A small thumbnail that plays the recording's clip, with a large playing preview on hover. For
 * rows listing recordings: the catalog's list and anything showing a recording it knows.
 */
export function RecordingThumbnail({
  recording,
}: {
  recording: CatalogRecording;
}): React.JSX.Element {
  const { classes } = useStyles();
  if (recording.thumbnail == undefined) {
    return <span className={classes.thumbnail} />;
  }
  return (
    <Tooltip
      placement="right"
      slotProps={{ tooltip: { className: classes.previewTooltip } }}
      title={<AnimatedThumbnail recording={recording} className={classes.preview} />}
    >
      <div>
        <AnimatedThumbnail recording={recording} className={classes.thumbnail} />
      </div>
    </Tooltip>
  );
}
