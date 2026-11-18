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
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useLatest } from "@lichtblick/hooks";
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

// Wheel delta needed per speed step: one mouse-wheel notch (~100px) is one step, while a
// trackpad's stream of small deltas doesn't skip through presets too fast.
const WHEEL_STEP_PX = 50;
const DOM_DELTA_PIXEL = 0; // WheelEvent.DOM_DELTA_PIXEL

const configSpeedSelector = (state: LayoutState) =>
  state.selectedLayout?.data?.playbackConfig.speed;

export default function PlaybackSpeedControls(): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("playbackSpeed");
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
  // the player reports the same speed. The ref mirrors it synchronously so back-to-back steps
  // (a fast wheel burst) build on each other instead of on the last render.
  const [draft, setDraftState] = useState<number | undefined>(undefined);
  const draftRef = useRef<number | undefined>(undefined);
  const setDraft = useCallback((value: number | undefined) => {
    draftRef.current = value;
    setDraftState(value);
  }, []);
  useEffect(() => {
    if (speed === draft) {
      setDraft(undefined);
    }
  }, [speed, draft, setDraft]);

  // A layout change we didn't write (undo/redo, command palette) wins over a pending draft.
  const lastWrittenRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (configSpeed !== lastWrittenRef.current) {
      setDraft(undefined);
    }
  }, [configSpeed, setDraft]);

  const setSpeed = useCallback(
    (newSpeed: number) => {
      setDraft(newSpeed);
      lastWrittenRef.current = newSpeed;
      setPlaybackConfig({ speed: newSpeed });
      setPlaybackSpeed?.(newSpeed);
    },
    [setDraft, setPlaybackConfig, setPlaybackSpeed],
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
  const latestShown = useLatest(shown);
  const step = useCallback(
    (dir: 1 | -1) => {
      setSpeed(stepSpeed(draftRef.current ?? latestShown.current, dir));
    },
    [latestShown, setSpeed],
  );

  // Slider drag: live speed on every move, one layout write on release. The slider keeps its
  // unrounded log coordinate while that still rounds to the shown speed, so small keyboard steps
  // accumulate instead of rounding back to where they started.
  const [sliderPos, setSliderPos] = useState<number | undefined>(undefined);
  const sliderValue =
    sliderPos != undefined && roundSpeed(10 ** sliderPos) === shown ? sliderPos : Math.log10(shown);
  const dragRef = useRef<{ start: number; value?: number } | undefined>(undefined);
  const cancelDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = undefined;
    if (drag?.value != undefined) {
      // A drag that never got its release: put the player back on the persisted speed.
      setDraft(drag.start);
      setPlaybackSpeed?.(drag.start);
    }
  }, [setDraft, setPlaybackSpeed]);

  // Scroll over the speed button: up = faster, down = slower. Non-passive so the page doesn't
  // scroll; React's onWheel is passive and can't preventDefault.
  const latestStep = useLatest(step);
  const wheelRef = useCallback(
    (el: HTMLButtonElement | null) => {
      if (!el) {
        return undefined;
      }
      let acc = 0;
      const onWheel = (event: WheelEvent) => {
        // Ctrl+wheel is browser zoom (and trackpad pinch in Chromium); leave it alone.
        if (el.disabled || event.ctrlKey) {
          return;
        }
        event.preventDefault();
        // Line/page-mode wheels (e.g. Firefox) report notches, not pixels: one event, one step.
        acc +=
          event.deltaMode === DOM_DELTA_PIXEL
            ? event.deltaY
            : Math.sign(event.deltaY) * WHEEL_STEP_PX;
        if (Math.abs(acc) >= WHEEL_STEP_PX) {
          latestStep.current(acc < 0 ? 1 : -1);
          acc = 0;
        }
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => {
        el.removeEventListener("wheel", onWheel);
      };
    },
    [latestStep],
  );

  return (
    <>
      <HoverableIconButton
        ref={wheelRef}
        id="playback-speed-button"
        aria-controls={open ? "playback-speed-popover" : undefined}
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : undefined}
        icon={<ArrowDropDownIcon fontSize="small" />}
        iconPosition="end"
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          setAnchorEl(event.currentTarget);
        }}
        data-testid="PlaybackSpeedControls-Dropdown"
        disabled={setPlaybackSpeed == undefined}
        title={t("scrollToChange")}
        color="inherit"
      >
        <span className={classes.speedText}>
          {displayedSpeed == undefined ? "–" : formatSpeed(draft ?? displayedSpeed)}
        </span>
      </HoverableIconButton>
      <Popover
        anchorEl={anchorEl}
        open={open}
        onClose={() => {
          setAnchorEl(undefined);
          cancelDrag();
          setSliderPos(undefined);
          setDraft(undefined); // don't keep a stale draft if the player clamped the speed
        }}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
        slotProps={{
          paper: {
            id: "playback-speed-popover",
            role: "dialog",
            "aria-labelledby": "playback-speed-title",
            className: classes.paper,
          },
        }}
      >
        <Stack direction="row" alignItems="baseline" justifyContent="space-between">
          <Typography
            id="playback-speed-title"
            variant="overline"
            color="text.secondary"
            className={classes.title}
          >
            {t("playbackSpeed")}
          </Typography>
          <Typography variant="h5" className={classes.value}>
            {formatSpeed(shown)}
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" gap={1}>
          <IconButton
            size="small"
            className={classes.stepButton}
            aria-label={t("slower")}
            disabled={shown <= MIN_SPEED}
            onClick={() => {
              step(-1);
            }}
          >
            <RemoveIcon fontSize="small" />
          </IconButton>
          <Slider
            className={classes.slider}
            aria-label={t("playbackSpeed")}
            min={LOG_MIN}
            max={LOG_MAX}
            step={0.01}
            marks={SLIDER_MARKS}
            value={sliderValue}
            valueLabelDisplay="off"
            getAriaValueText={(v) => formatSpeed(roundSpeed(10 ** v))}
            onPointerCancel={cancelDrag}
            onChange={(_e, v) => {
              const next = roundSpeed(10 ** v);
              dragRef.current ??= { start: configSpeed ?? current };
              dragRef.current.value = next;
              setSliderPos(v);
              setDraft(next);
              setPlaybackSpeed?.(next);
            }}
            onChangeCommitted={() => {
              // Only commit what this interaction changed; MUI also commits on a key press at
              // the limit or a click that didn't move the value.
              const drag = dragRef.current;
              dragRef.current = undefined;
              if (drag?.value != undefined) {
                setSpeed(drag.value);
              }
            }}
          />
          <IconButton
            size="small"
            className={classes.stepButton}
            aria-label={t("faster")}
            disabled={shown >= MAX_SPEED}
            onClick={() => {
              step(1);
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
