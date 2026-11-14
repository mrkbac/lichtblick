// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { subtract, toSec } from "@foxglove/rostime";
import AlignHorizontalLeftIcon from "@mui/icons-material/AlignHorizontalLeft";
import AlignHorizontalRightIcon from "@mui/icons-material/AlignHorizontalRight";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { Button, IconButton, InputAdornment, TextField, Tooltip, Typography } from "@mui/material";
import * as _ from "lodash-es";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Stack from "@lichtblick/suite-base/components/Stack";
import { formatDuration } from "@lichtblick/suite-base/util/formatTime";

import { CompareSideInfo, sideSharedEnd, useCompare } from "./CompareContext";

const useStyles = makeStyles()((theme) => ({
  side: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    columnGap: theme.spacing(1),
    rowGap: theme.spacing(0.5),
    alignItems: "center",
  },
  swatch: {
    width: 18,
    height: 18,
    borderRadius: 4,
    color: "#000",
    fontSize: 11,
    fontWeight: 700,
    lineHeight: "18px",
    textAlign: "center",
  },
  controls: {
    gridColumn: 2,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.25),
    flexWrap: "wrap",
  },
  offset: { width: 120 },
  nudge: { minWidth: 0, padding: theme.spacing(0, 0.5) },
}));

const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectSetOffsets = (ctx: MessagePipelineContext) => ctx.setCompareOffsets;

const NUDGES = [-1, -0.1, 0.1, 1];

/** Rounded to the nanosecond, so float noise doesn't show up in the offset field */
function roundSec(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

function SideOffset({
  side,
  onOffset,
}: {
  side: CompareSideInfo;
  /** The new offset, or how to get it from the latest one asked for */
  onOffset: (offsetSec: number | ((current: number) => number)) => void;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("compare");
  const currentTime = useMessagePipeline(selectCurrentTime);
  const [draft, setDraft] = useState(String(side.offsetSec));
  useEffect(() => {
    setDraft(String(side.offsetSec));
  }, [side.offsetSec]);

  const commit = () => {
    const value = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(value)) {
      onOffset(roundSec(value));
    } else {
      setDraft(String(side.offsetSec));
    }
  };
  // Move the side so that `edge` (its start or end on the shared timeline) lands on the playhead
  const snap = (edge: "start" | "end") => {
    if (!currentTime) {
      return;
    }
    const at = edge === "start" ? side.sharedStart : sideSharedEnd(side);
    onOffset(roundSec(side.offsetSec + toSec(subtract(currentTime, at))));
  };

  return (
    <div className={classes.side}>
      <span className={classes.swatch} style={{ backgroundColor: side.color }}>
        {side.label}
      </span>
      <Typography variant="body2" noWrap title={side.name}>
        {side.name}{" "}
        <Typography component="span" variant="caption" color="text.secondary">
          {formatDuration(subtract(side.end, side.start))}
        </Typography>
      </Typography>
      <div className={classes.controls}>
        <TextField
          className={classes.offset}
          size="small"
          variant="filled"
          label={t("offset")}
          value={draft}
          inputMode="decimal"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
            }
          }}
          slotProps={{
            input: { endAdornment: <InputAdornment position="end">s</InputAdornment> },
          }}
        />
        {NUDGES.map((step) => (
          <Button
            key={step}
            className={classes.nudge}
            size="small"
            variant="text"
            title={t("nudge", { step: `${step > 0 ? "+" : ""}${step}` })}
            onClick={() => {
              onOffset((current) => roundSec(current + step));
            }}
          >
            {step > 0 ? "+" : "−"}
            {Math.abs(step)}
          </Button>
        ))}
        <Tooltip title={t("startAtPlayhead")}>
          <IconButton
            size="small"
            aria-label={t("startAtPlayhead")}
            onClick={() => {
              snap("start");
            }}
          >
            <AlignHorizontalLeftIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("endAtPlayhead")}>
          <IconButton
            size="small"
            aria-label={t("endAtPlayhead")}
            onClick={() => {
              snap("end");
            }}
          >
            <AlignHorizontalRightIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("resetOffset")}>
          <span>
            <IconButton
              size="small"
              aria-label={t("resetOffset")}
              disabled={side.offsetSec === 0}
              onClick={() => {
                onOffset(0);
              }}
            >
              <RestartAltIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * The offsets to ask for when `side` changes: built on the newest request the player hasn't shown
 * yet, else on the published offsets, so quick edits to different sides don't undo each other
 */
export function nextOffsets(
  published: readonly number[],
  pending: readonly number[] | undefined,
  side: number,
  change: number | ((current: number) => number),
): number[] {
  const base = pending ?? published;
  return base.map((value, index) =>
    index !== side ? value : typeof change === "function" ? change(value) : change,
  );
}

/**
 * The request still on its way once the player published `published`: none when it shows the
 * request, else the request (an older publication never replaces a newer request)
 */
export function settledRequest(
  published: readonly number[],
  pending: readonly number[] | undefined,
): number[] | undefined {
  return pending && !_.isEqual(pending, published) ? [...pending] : undefined;
}

/** The compared recordings with controls to move each along the shared timeline */
export function CompareSidesEditor(): React.JSX.Element | undefined {
  const compare = useCompare();
  const setOffsets = useMessagePipeline(selectSetOffsets);
  const { t } = useTranslation("compare");
  // The offsets last asked for while the player hasn't shown them yet (see nextOffsets)
  const published = compare?.sides.map((side) => side.offsetSec);
  const pending = useRef<number[] | undefined>(undefined);
  pending.current = published && settledRequest(published, pending.current);
  if (!compare) {
    return undefined;
  }
  return (
    <Stack gap={1.5}>
      <Typography variant="caption" color="text.secondary">
        {t("offsetsHint")}
      </Typography>
      {compare.sides.map((side) => (
        <SideOffset
          key={side.prefix}
          side={side}
          onOffset={(offsetSec) => {
            const next = nextOffsets(published!, pending.current, side.index, offsetSec);
            pending.current = next;
            setOffsets?.(next);
          }}
        />
      ))}
    </Stack>
  );
}
