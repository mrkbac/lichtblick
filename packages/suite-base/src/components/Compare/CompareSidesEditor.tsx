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
 * yet (the last of `inFlight`), else on the published offsets, so quick edits to different sides
 * don't undo each other
 */
export function nextOffsets(
  published: readonly number[],
  inFlight: readonly (readonly number[])[],
  side: number,
  change: number | ((current: number) => number),
): number[] {
  const base = inFlight.at(-1) ?? published;
  return base.map((value, index) =>
    index !== side ? value : typeof change === "function" ? change(value) : change,
  );
}

/**
 * The requests still on their way after the player published `published`. Called only for a new
 * publication: it acknowledges the oldest request it equals and every one before it (the player
 * applies them in order, and may skip some), never a newer request that merely equals it
 */
export function acknowledge(
  inFlight: readonly (readonly number[])[],
  published: readonly number[],
): (readonly number[])[] {
  const index = inFlight.findIndex((request) => _.isEqual(request, published));
  return index < 0 ? [...inFlight] : inFlight.slice(index + 1);
}

/**
 * The offset requests the player hasn't shown yet (see nextOffsets), acknowledged once per
 * publication: `publication` is the object the player publishes the sides in, which changes only
 * when the player applies offsets (not when e.g. the active side changes)
 */
export function useOffsetRequests(
  publication: object | undefined,
  published: readonly number[] | undefined,
): { current: (readonly number[])[] } {
  const inFlight = useRef<(readonly number[])[]>([]);
  const seen = useRef(publication);
  if (publication && published && seen.current !== publication) {
    seen.current = publication;
    inFlight.current = acknowledge(inFlight.current, published);
  }
  return inFlight;
}

const selectPublishedSides = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.compareSides;

/** The compared recordings with controls to move each along the shared timeline */
export function CompareSidesEditor(): React.JSX.Element | undefined {
  const compare = useCompare();
  const setOffsets = useMessagePipeline(selectSetOffsets);
  const publication = useMessagePipeline(selectPublishedSides);
  const { t } = useTranslation("compare");
  const published = publication?.map((side) => side.offsetSec);
  const inFlight = useOffsetRequests(publication, published);
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
            const next = nextOffsets(published!, inFlight.current, side.index, offsetSec);
            inFlight.current = [...inFlight.current, next];
            setOffsets?.(next);
          }}
        />
      ))}
    </Stack>
  );
}
