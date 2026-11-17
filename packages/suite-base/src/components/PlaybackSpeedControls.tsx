// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AddIcon from "@mui/icons-material/Add";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import RemoveIcon from "@mui/icons-material/Remove";
import { Chip, IconButton, Popover, Slider, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";

import HoverableIconButton from "@lichtblick/suite-base/components/HoverableIconButton";
import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import { useStyles } from "@lichtblick/suite-base/components/PlaybackSpeedControls.style";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";

export const PLAYBACK_SPEED_OPTIONS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 0.8, 1, 2, 3, 5, 10, 20, 50, 100,
];

const QUICK_SPEEDS = [0.1, 0.5, 1, 2, 5, 10];
const MIN_SPEED = PLAYBACK_SPEED_OPTIONS[0]!;
const MAX_SPEED = PLAYBACK_SPEED_OPTIONS[PLAYBACK_SPEED_OPTIONS.length - 1]!;
// Slider runs in log10 space so 0.01× and 100× are equally reachable.
const LOG_MIN = Math.log10(MIN_SPEED);
const LOG_MAX = Math.log10(MAX_SPEED);
const SLIDER_MARKS = [0.01, 0.1, 1, 10, 100].map((v) => ({ value: Math.log10(v) }));

/** Round to 2 significant digits so slider values read like 0.37×, 1.2×, 45×. */
export const roundSpeed = (val: number): number =>
  Math.min(MAX_SPEED, Math.max(MIN_SPEED, Number(val.toPrecision(2))));

export const formatSpeed = (val: number): string => `${Number(val.toPrecision(3))}×`;

/** Next preset above/below `speed`; lets +/− jump from any free slider value. */
export const stepSpeed = (speed: number, dir: 1 | -1): number => {
  const next =
    dir === 1
      ? PLAYBACK_SPEED_OPTIONS.find((o) => o > speed + 1e-9)
      : PLAYBACK_SPEED_OPTIONS.findLast((o) => o < speed - 1e-9);
  return next ?? speed;
};

const configSpeedSelector = (state: LayoutState) =>
  state.selectedLayout?.data?.playbackConfig.speed;

export default function PlaybackSpeedControls(): React.JSX.Element {
  const { classes } = useStyles();
  const [anchorEl, setAnchorEl] = useState<undefined | HTMLElement>(undefined);
  const open = Boolean(anchorEl);
  const configSpeed = useCurrentLayoutSelector(configSpeedSelector);
  const speed = useMessagePipeline(
    useCallback(({ playerState }) => playerState.activeData?.speed, []),
  );
  const setPlaybackSpeed = useMessagePipeline(useCallback((state) => state.setPlaybackSpeed, []));
  const { setPlaybackConfig } = useCurrentLayoutActions();
  const setSpeed = useCallback(
    (newSpeed: number) => {
      setPlaybackConfig({ speed: newSpeed });
      setPlaybackSpeed?.(newSpeed);
    },
    [setPlaybackConfig, setPlaybackSpeed],
  );

  // Set the speed to the speed that we got from the config whenever we get a new Player.
  useEffect(() => {
    if (configSpeed != undefined) {
      setPlaybackSpeed?.(configSpeed);
    }
  }, [configSpeed, setPlaybackSpeed]);

  const displayedSpeed = speed ?? configSpeed;
  const current = displayedSpeed ?? 1;

  return (
    <>
      <HoverableIconButton
        id="playback-speed-button"
        aria-controls={open ? "playback-speed-popover" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
        icon={<ArrowDropDownIcon fontSize="small" />}
        iconPosition="end"
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          setAnchorEl(event.currentTarget);
        }}
        data-testid="PlaybackSpeedControls-Dropdown"
        disabled={setPlaybackSpeed == undefined}
        title="Playback speed"
        color="inherit"
      >
        <span className={classes.speedText}>
          {displayedSpeed == undefined ? "–" : formatSpeed(displayedSpeed)}
        </span>
      </HoverableIconButton>
      <Popover
        id="playback-speed-popover"
        anchorEl={anchorEl}
        open={open}
        onClose={() => {
          setAnchorEl(undefined);
        }}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
        slotProps={{ paper: { className: classes.paper } }}
      >
        <Typography variant="body2" align="center" className={classes.value}>
          {formatSpeed(current)}
        </Typography>
        <Stack direction="row" alignItems="center" gap={1}>
          <IconButton
            size="small"
            aria-label="Slower"
            disabled={current <= MIN_SPEED}
            onClick={() => {
              setSpeed(stepSpeed(current, -1));
            }}
          >
            <RemoveIcon fontSize="small" />
          </IconButton>
          <Slider
            size="small"
            aria-label="Playback speed"
            min={LOG_MIN}
            max={LOG_MAX}
            step={0.01}
            marks={SLIDER_MARKS}
            value={Math.log10(current)}
            scale={(v) => roundSpeed(10 ** v)}
            valueLabelDisplay="off"
            getAriaValueText={(v) => formatSpeed(roundSpeed(10 ** v))}
            // Live speed while dragging; persist to the layout (one undo step) on release.
            onChange={(_e, v) => {
              setPlaybackSpeed?.(roundSpeed(10 ** v));
            }}
            onChangeCommitted={(_e, v) => {
              setSpeed(roundSpeed(10 ** v));
            }}
          />
          <IconButton
            size="small"
            aria-label="Faster"
            disabled={current >= MAX_SPEED}
            onClick={() => {
              setSpeed(stepSpeed(current, 1));
            }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Stack direction="row" gap={0.5} justifyContent="center">
          {QUICK_SPEEDS.map((option) => (
            <Chip
              key={option}
              size="small"
              label={formatSpeed(option)}
              color={current === option ? "primary" : "default"}
              variant={current === option ? "filled" : "outlined"}
              onClick={() => {
                setSpeed(option);
              }}
            />
          ))}
        </Stack>
      </Popover>
    </>
  );
}
