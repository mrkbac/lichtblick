// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { compare as compareTimes, subtract as subtractTimes, toSec, Time } from "@foxglove/rostime";
import { Divider, Typography } from "@mui/material";
import * as _ from "lodash-es";
import { Fragment, useEffect, useRef } from "react";
import { makeStyles } from "tss-react/mui";

import {
  sideLocalTime,
  sideSharedEnd,
  useCompare,
} from "@lichtblick/suite-base/components/Compare/CompareContext";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@lichtblick/suite-base/context/TimelineInteractionStateContext";
import { useAppTimeFormat } from "@lichtblick/suite-base/hooks";
import { customTypography } from "@lichtblick/theme";

import { THUMBNAIL_WIDTH } from "./scrubPreview";

type PlaybackControlsTooltipItem =
  | { type: "divider" }
  | { type: "item"; title: string; value: string };

const useStyles = makeStyles()((theme) => ({
  tooltipDivider: {
    gridColumn: "span 2",
    marginBlock: theme.spacing(0.5),
    opacity: 0.5,
  },
  tooltipWrapper: {
    fontFeatureSettings: `${customTypography.fontFeatureSettings}, "zero"`,
    fontFamily: theme.typography.body1.fontFamily,
    whiteSpace: "nowrap",
    columnGap: theme.spacing(0.5),
    display: "grid",
    alignItems: "center",
    gridTemplateColumns: "auto auto",
    width: "100%",
    flexDirection: "column",
  },
  thumbnail: {
    gridColumn: "span 2",
    justifySelf: "center",
    display: "block",
    width: THUMBNAIL_WIDTH,
    height: "auto",
    marginBottom: theme.spacing(0.5),
    borderRadius: theme.shape.borderRadius,
  },
  itemKey: {
    fontSize: "0.7rem",
    opacity: 0.7,
    textAlign: "end",
    textTransform: "lowercase",
  },
}));

const selectHoveredEvents = (store: TimelineInteractionStateStore) => store.eventsAtHoverValue;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;

function Thumbnail({ bitmap, className }: { bitmap: ImageBitmap; className: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    // A closed (evicted) bitmap has zero size; keep the last drawn frame instead.
    if (!canvas || bitmap.width === 0) {
      return;
    }
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return <canvas ref={ref} className={className} data-testid="scrub-preview-thumbnail" />;
}

export function PlaybackControlsTooltipContent(params: {
  stamp: Time;
  thumbnail?: ImageBitmap;
}): null | React.JSX.Element {
  const { stamp, thumbnail } = params;
  const { timeFormat, formatTime, formatDate } = useAppTimeFormat();
  const hoveredEvents = useTimelineInteractionState(selectHoveredEvents);
  const startTime = useMessagePipeline(selectStartTime);
  const compare = useCompare();
  const { classes } = useStyles();

  if (!startTime) {
    return null;
  }

  const timeFromStart = subtractTimes(stamp, startTime);

  const tooltipItems: PlaybackControlsTooltipItem[] = [];

  if (!_.isEmpty(hoveredEvents)) {
    Object.values(hoveredEvents).forEach(({ event }) => {
      tooltipItems.push({
        type: "item",
        title: "Start",
        value: formatTime(event.startTime),
      });
      tooltipItems.push({
        type: "item",
        title: "End",
        value: formatTime(event.endTime),
      });
      if (!_.isEmpty(event.metadata)) {
        Object.entries(event.metadata).forEach(([metaKey, metaValue]) => {
          tooltipItems.push({ type: "item", title: metaKey, value: metaValue });
        });
      }
      tooltipItems.push({ type: "divider" });
    });
  }

  switch (timeFormat) {
    case "TOD":
      tooltipItems.push({ type: "item", title: "Date", value: formatDate(stamp) });
      tooltipItems.push({ type: "item", title: "Time", value: formatTime(stamp) });
      break;
    case "SEC":
      tooltipItems.push({ type: "item", title: "SEC", value: formatTime(stamp) });
      break;
  }

  tooltipItems.push({
    type: "item",
    title: "Elapsed",
    value: `${toSec(timeFromStart).toFixed(9)} sec`,
  });

  // Each compared recording's own time here, if it covers this moment
  if (compare) {
    tooltipItems.push({ type: "divider" });
    for (const side of compare.sides) {
      const inRange =
        compareTimes(stamp, side.sharedStart) >= 0 && compareTimes(stamp, sideSharedEnd(side)) <= 0;
      tooltipItems.push({
        type: "item",
        title: `${side.label} · ${side.name}`,
        value: inRange ? formatTime(sideLocalTime(side, stamp)) : "–",
      });
    }
  }

  return (
    <div className={classes.tooltipWrapper}>
      {thumbnail && <Thumbnail bitmap={thumbnail} className={classes.thumbnail} />}
      {tooltipItems.map((item, idx) => {
        if (item.type === "divider") {
          return <Divider key={`divider_${idx}`} className={classes.tooltipDivider} />;
        }
        return (
          <Fragment key={`${item.title}_${idx}`}>
            <Typography className={classes.itemKey} noWrap>
              {item.title}
            </Typography>
            <Typography variant="subtitle2" noWrap>
              {item.value}
            </Typography>
          </Fragment>
        );
      })}
    </div>
  );
}
