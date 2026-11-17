// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AddIcon from "@mui/icons-material/Add";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import RemoveIcon from "@mui/icons-material/Remove";
import {
  IconButton,
  Popover,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
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
const SLIDER_MARKS = [0.01, 0.1, 1, 10, 100].map((v) => ({
  value: Math.log10(v),
  label: `${v}×`,
}));

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
  // Optimistic value: the player echoes speed changes back asynchronously (throttled), so a
  // control bound to the echoed speed lags and snaps back while dragging. Show the draft until
  // the player reports the same speed.
  const [draft, setDraft] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (speed === draft) {
      setDraft(undefined);
    }
  }, [speed, draft]);
  const setSpeed = useCallback(
    (newSpeed: number) => {
      setDraft(newSpeed);
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
  const shown = draft ?? current;

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
          {displayedSpeed == undefined ? "–" : formatSpeed(draft ?? displayedSpeed)}
        </span>
      </HoverableIconButton>
      <Popover
        id="playback-speed-popover"
        anchorEl={anchorEl}
        open={open}
        onClose={() => {
          setAnchorEl(undefined);
          setDraft(undefined); // don't keep a stale draft if the player clamped the speed
        }}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
        slotProps={{ paper: { className: classes.paper } }}
      >
        <Stack direction="row" alignItems="baseline" justifyContent="space-between">
          <Typography variant="overline" color="text.secondary" className={classes.title}>
            Playback speed
          </Typography>
          <Typography variant="h5" className={classes.value}>
            {formatSpeed(shown)}
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" gap={1}>
          <IconButton
            size="small"
            className={classes.stepButton}
            aria-label="Slower"
            disabled={current <= MIN_SPEED}
            onClick={() => {
              setSpeed(stepSpeed(current, -1));
            }}
          >
            <RemoveIcon fontSize="small" />
          </IconButton>
          <Slider
            className={classes.slider}
            aria-label="Playback speed"
            min={LOG_MIN}
            max={LOG_MAX}
            step={0.01}
            marks={SLIDER_MARKS}
            value={Math.log10(shown)}
            valueLabelDisplay="off"
            getAriaValueText={(v) => formatSpeed(roundSpeed(10 ** v))}
            // Live speed while dragging; persist on release so a drag is one layout undo step.
            onChange={(_e, v) => {
              const next = roundSpeed(10 ** v);
              setDraft(next);
              setPlaybackSpeed?.(next);
            }}
            onChangeCommitted={(_e, v) => {
              setSpeed(roundSpeed(10 ** v));
            }}
          />
          <IconButton
            size="small"
            className={classes.stepButton}
            aria-label="Faster"
            disabled={current >= MAX_SPEED}
            onClick={() => {
              setSpeed(stepSpeed(current, 1));
            }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Stack>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          color="primary"
          value={QUICK_SPEEDS.includes(shown) ? shown : null}
          onChange={(_e, v: number | null) => {
            if (v != null) {
              setSpeed(v);
            }
          }}
        >
          {QUICK_SPEEDS.map((option) => (
            <ToggleButton key={option} value={option} className={classes.preset}>
              {formatSpeed(option)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Popover>
    </>
  );
}
