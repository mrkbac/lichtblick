// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Time,
  isTimeInRangeInclusive,
  subtract as subtractTimes,
  toNanoSec,
} from "@foxglove/rostime";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CheckIcon from "@mui/icons-material/Check";
import WarningIcon from "@mui/icons-material/Warning";
import {
  TextField,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  filledInputClasses,
  iconButtonClasses,
  inputBaseClasses,
} from "@mui/material";
import { useState, useCallback, useMemo, useEffect, MouseEvent, useRef } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import CopyButton from "@lichtblick/suite-base/components/CopyButton";
import Stack from "@lichtblick/suite-base/components/Stack";
import { IAppTimeFormat } from "@lichtblick/suite-base/hooks/useAppTimeFormat";
import { playbackTime } from "@lichtblick/suite-base/i18n/en/playbackTime";
import { TimeDisplayMethod } from "@lichtblick/suite-base/types/panels";
import clipboard from "@lichtblick/suite-base/util/clipboard";
import {
  format,
  formatHms,
  getValidatedTimeAndMethodFromString,
} from "@lichtblick/suite-base/util/formatTime";
import { matchesCombo } from "@lichtblick/suite-base/util/keyboardShortcuts";
import { formatTimeRaw } from "@lichtblick/suite-base/util/time";
import { customTypography } from "@lichtblick/theme";

type PlaybackTimeDisplayMethodProps = {
  appTimeFormat: IAppTimeFormat;
  currentTime?: Time;
  startTime?: Time;
  endTime?: Time;
  timezone?: string;
  onSeek: (arg0: Time) => void;
  onPause: () => void;
  isPlaying: boolean;
};

const useStyles = makeStyles()((theme) => ({
  textField: {
    borderRadius: theme.shape.borderRadius,

    "&.Mui-disabled": {
      [`.${filledInputClasses.root}`]: {
        backgroundColor: "transparent",
      },
    },
    "&:not(.Mui-disabled):hover": {
      backgroundColor: theme.palette.action.hover,
    },
    // Opacity rather than visibility, so the buttons stay reachable with Tab.
    "&:not(.Mui-disabled):hover, &:focus-within": {
      [`.${iconButtonClasses.root}`]: {
        opacity: 1,
      },
    },
    [`.${filledInputClasses.root}`]: {
      backgroundColor: "transparent",

      ":hover": {
        backgroundColor: "transparent",
      },
    },
    [`.${inputBaseClasses.input}`]: {
      fontFeatureSettings: `${customTypography.fontFeatureSettings}, 'zero' !important`,
      fontVariantNumeric: "tabular-nums", // Example of a valid property
      // Fit the displayed time exactly so long timezone names aren't cut off.
      fieldSizing: "content",
    },
    [`.${iconButtonClasses.root}`]: {
      borderTopLeftRadius: 0,
      borderBottomLeftRadius: 0,
      borderLeft: `1px solid ${theme.palette.background.paper}`,
      opacity: 0,

      // Only the last button reaches into the field's padding; the copy button sits beside it.
      "&:last-child": {
        marginRight: theme.spacing(-1),
      },
    },
  },
  rowValue: {
    fontVariantNumeric: "tabular-nums",
  },
  textFieldError: {
    outline: `1px solid ${theme.palette.error.main}`,
    outlineOffset: -1,

    [`.${inputBaseClasses.root}`]: {
      color: theme.palette.error.main,
      borderLeftColor: theme.palette.error.main,
    },
  },
}));

/** UTC ISO 8601 with full nanosecond precision, e.g. "2025-06-12T08:50:40.599000000Z". */
export function formatIsoUtc(time: Time): string {
  const seconds = new Date(time.sec * 1000).toISOString().slice(0, 19);
  return `${seconds}.${String(time.nsec).padStart(9, "0")}Z`;
}

const COPY_COMBO = { key: "c", mod: true, alt: false };

/** h:mm:ss.nnnnnnnnn, keeping the nanoseconds a millisecond format would round away. */
export function formatElapsed(elapsed: Time): string {
  const hms = formatHms(elapsed.sec * 1000, { withMillis: false });
  return `${hms}.${String(elapsed.nsec).padStart(9, "0")}`;
}

type TimeFormatRow = {
  /** Display formats can be selected; the others are copy-only. */
  key: TimeDisplayMethod | "ISO" | "NS" | "ELAPSED";
  label: keyof typeof playbackTime;
  value: string;
};

function timeFormatRows(
  currentTime: Time,
  startTime: Time | undefined,
  timeOfDayString: string,
  timeRawString: string,
): TimeFormatRow[] {
  const rows: TimeFormatRow[] = [
    { key: "TOD", label: "timeOfDay", value: timeOfDayString },
    { key: "SEC", label: "seconds", value: timeRawString },
    { key: "ISO", label: "isoUtc", value: formatIsoUtc(currentTime) },
    { key: "NS", label: "nanoseconds", value: toNanoSec(currentTime).toString() },
  ];
  if (startTime) {
    rows.push({
      key: "ELAPSED",
      label: "sinceStart",
      value: formatElapsed(subtractTimes(currentTime, startTime)),
    });
  }
  return rows;
}

function PlaybackTimeMethodMenu({
  timeFormat,
  rows,
  setTimeFormat,
}: {
  timeFormat: TimeDisplayMethod;
  rows: TimeFormatRow[];
  setTimeFormat: (format: TimeDisplayMethod) => Promise<void>;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("playbackTime");
  const [anchorEl, setAnchorEl] = useState<undefined | HTMLElement>(undefined);
  const open = Boolean(anchorEl);
  // Shown in place of the row's label, so keyboard copies get feedback too.
  const [copiedKey, setCopiedKey] = useState<TimeFormatRow["key"] | undefined>();

  useEffect(() => {
    if (copiedKey == undefined) {
      return;
    }
    const id = setTimeout(() => {
      setCopiedKey(undefined);
    }, 1500);
    return () => {
      clearTimeout(id);
    };
  }, [copiedKey]);

  const copyRow = (row: TimeFormatRow) => {
    clipboard
      .copy(row.value)
      .then(() => {
        setCopiedKey(row.key);
      })
      .catch((err: unknown) => {
        console.warn(err);
      });
  };

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(undefined);
  };

  return (
    <>
      <IconButton
        id="playback-time-display-toggle-button"
        data-testid="playback-time-display-toggle-button"
        aria-controls={open ? "playback-time-display-toggle-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
        onClick={handleClick}
        size="small"
      >
        <ArrowDropDownIcon fontSize="small" />
      </IconButton>
      <Menu
        id="playback-time-display-toggle-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        slotProps={{
          list: {
            dense: true,
            "aria-labelledby": "playback-time-display-toggle-button",
          },
        }}
        anchorOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
      >
        {rows.flatMap((row) => {
          const selected = timeFormat === row.key;
          const item = (
            <MenuItem
              key={row.key}
              data-testid={`playback-time-display-option-${row.key}`}
              selected={selected}
              // Display formats are selected; the others are copied, keeping the menu open.
              onClick={async () => {
                if (row.key === "TOD" || row.key === "SEC") {
                  await setTimeFormat(row.key);
                  handleClose();
                } else {
                  copyRow(row);
                }
              }}
              // The row copy buttons can't take focus inside a menu; Ctrl/Cmd+C copies the focused row.
              onKeyDown={(event) => {
                if (matchesCombo(event, COPY_COMBO)) {
                  event.preventDefault();
                  copyRow(row);
                }
              }}
            >
              {selected && (
                <ListItemIcon>
                  <CheckIcon fontSize="small" />
                </ListItemIcon>
              )}
              <ListItemText
                inset={!selected}
                primary={row.value}
                secondary={copiedKey === row.key ? t("copied") : t(row.label)}
                slotProps={{
                  primary: { variant: "inherit", className: classes.rowValue },
                }}
              />
              {/* Copying must not also select the row. */}
              <span
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <CopyButton
                  size="small"
                  iconSize="small"
                  color="inherit"
                  aria-label={t("copyValue", { label: t(row.label) })}
                  getText={() => row.value}
                />
              </span>
            </MenuItem>
          );
          // Separate the selectable display formats from the copy-only ones.
          return row.key === "SEC" ? [item, <Divider key="divider" />] : [item];
        })}
      </Menu>
    </>
  );
}

export function UnconnectedPlaybackTimeDisplay({
  appTimeFormat,
  currentTime,
  startTime,
  endTime,
  timezone,
  onSeek,
  onPause,
  isPlaying,
}: PlaybackTimeDisplayMethodProps): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("playbackTime");
  const timeOutID = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Whether the user typed since focusing; the current time may change meanwhile.
  const edited = useRef(false);

  const timeRawString = useMemo(
    () => (currentTime ? formatTimeRaw(currentTime) : undefined),
    [currentTime],
  );
  const timeOfDayString = useMemo(
    () => (currentTime ? format(currentTime, timezone) : undefined),
    [currentTime, timezone],
  );
  const currentTimeString = useMemo(
    () => (appTimeFormat.timeFormat === "SEC" ? timeRawString : timeOfDayString),
    [appTimeFormat.timeFormat, timeRawString, timeOfDayString],
  );
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [inputText, setInputText] = useState<string | undefined>(currentTimeString ?? undefined);
  const [hasError, setHasError] = useState<boolean>(false);

  const onSubmit = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();

      if (inputText == undefined || inputText.length === 0) {
        return;
      }
      if (!startTime || !currentTime || !endTime) {
        return;
      }

      const validTimeAndMethod = getValidatedTimeAndMethodFromString({
        text: inputText,
        timezone,
      });

      if (validTimeAndMethod == undefined) {
        setHasError(true);
        return;
      }

      // If input is valid, clear error state, exit edit mode, and seek to input timestamp
      setHasError(false);

      if (
        validTimeAndMethod.time &&
        isTimeInRangeInclusive(validTimeAndMethod.time, startTime, endTime)
      ) {
        onSeek(validTimeAndMethod.time);
        if (validTimeAndMethod.method !== appTimeFormat.timeFormat) {
          void appTimeFormat.setTimeFormat(validTimeAndMethod.method);
        }
      }
    },
    [inputText, startTime, currentTime, endTime, timezone, onSeek, appTimeFormat],
  );

  useEffect(() => {
    // If user submits an empty input field or resumes playback, clear error state and show current timestamp
    if (hasError && (inputText == undefined || inputText.length === 0 || isPlaying)) {
      setIsEditing(false);
      setHasError(false);
    }

    return () => {
      if (timeOutID.current != undefined) {
        clearTimeout(timeOutID.current);
      }
    };
  }, [hasError, inputText, isPlaying]);

  const displayedText = isEditing ? inputText : currentTimeString;

  return (
    <Stack direction="row" alignItems="center" flexGrow={0} gap={0.5}>
      {currentTime ? (
        <form onSubmit={onSubmit} style={{ width: "100%" }}>
          <TextField
            className={cx(classes.textField, { [classes.textFieldError]: hasError })}
            aria-label="Playback Time Method"
            data-testid="PlaybackTime-text"
            value={displayedText}
            error={hasError}
            variant="filled"
            size="small"
            slotProps={{
              // Approximate width for browsers without `field-sizing` support.
              htmlInput: { size: displayedText ? displayedText.length : undefined },
              input: {
                startAdornment: hasError ? <WarningIcon color="error" /> : undefined,
                endAdornment: (
                  <>
                    <CopyButton
                      size="small"
                      iconSize="small"
                      color="inherit"
                      aria-label={t("copyCurrentTime")}
                      getText={() => currentTimeString ?? ""}
                    />
                    <PlaybackTimeMethodMenu
                      timeFormat={appTimeFormat.timeFormat}
                      setTimeFormat={appTimeFormat.setTimeFormat}
                      rows={timeFormatRows(
                        currentTime,
                        startTime,
                        timeOfDayString ?? "",
                        timeRawString ?? "",
                      )}
                    />
                  </>
                ),
              },
            }}
            onFocus={(e) => {
              onPause();
              setHasError(false);
              setIsEditing(true);
              setInputText(currentTimeString);
              edited.current = false;
              e.target.select();
            }}
            onBlur={(e) => {
              // Leaving the field unedited (e.g. tabbing to the copy button) must not seek: the
              // displayed time is rounded, so re-parsing it would move playback.
              if (edited.current) {
                onSubmit(e);
              }
              setIsEditing(false);
              timeOutID.current = setTimeout(() => {
                setHasError(false);
              }, 600);
            }}
            onChange={(event) => {
              setInputText(event.target.value);
              edited.current = true;
            }}
          />
        </form>
      ) : (
        <TextField
          className={cx(classes.textField, "Mui-disabled")}
          disabled
          variant="filled"
          size="small"
          defaultValue={
            appTimeFormat.timeFormat === "SEC" ? "0000000000.000000000" : "0000-00-00 00:00:00.000"
          }
          slotProps={{
            input: {
              endAdornment: (
                <IconButton edge="end" size="small" disabled>
                  <ArrowDropDownIcon fontSize="small" />
                </IconButton>
              ),
            },
          }}
        />
      )}
    </Stack>
  );
}
