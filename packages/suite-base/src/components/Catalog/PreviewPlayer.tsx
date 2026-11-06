// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromSec } from "@foxglove/rostime";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { IconButton, LinearProgress, MenuItem, Select, Slider, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsync } from "react-use";
import { makeStyles } from "tss-react/mui";

import Stack from "@lichtblick/suite-base/components/Stack";
import { formatDuration } from "@lichtblick/suite-base/util/formatTime";

import { PREVIEW_FPS, PreviewFrame } from "./preview";
import { isCompressedImageSchema } from "./thumbnail";
import { CatalogRecording } from "./types";

const useStyles = makeStyles()((theme) => ({
  screen: {
    position: "relative",
    aspectRatio: "16 / 9",
    borderRadius: theme.shape.borderRadius,
    overflow: "hidden",
    backgroundColor: theme.palette.action.hover,
    cursor: "ew-resize",
  },
  image: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  loading: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Jump between frames instead of gliding, so the bar shows the clip is a few stills, not video.
  seek: {
    "& .MuiSlider-thumb, & .MuiSlider-track": { transition: "none" },
  },
  time: {
    minWidth: 120,
    textAlign: "right",
    fontFeatureSettings: `"tnum"`,
  },
}));

type Props = {
  recording: CatalogRecording;
  /** Reads the preview frames of an image topic; absent when the file can't be read here. */
  loadPreview?: (topic: string) => Promise<PreviewFrame[]>;
};

/** A looping low frame rate preview of a recording's camera, scrubbed by hovering. */
export function PreviewPlayer({ recording, loadPreview }: Props): React.JSX.Element | null {
  const { classes } = useStyles();
  const { t } = useTranslation("catalog");
  const imageTopics = useMemo(
    () =>
      (recording.topics ?? [])
        .filter((topic) => isCompressedImageSchema(topic.schema))
        .map((topic) => topic.name)
        .sort(),
    [recording.topics],
  );
  // Same default as the thumbnail: the busiest camera, whose clip is cached.
  const [topic, setTopic] = useState(recording.previewTopics?.[0] ?? imageTopics[0]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);

  const {
    value: frames,
    loading,
    error,
  } = useAsync(
    async () => (loadPreview && topic != undefined ? await loadPreview(topic) : undefined),
    [loadPreview, topic],
  );

  useEffect(() => {
    setIndex(0);
  }, [frames]);

  useEffect(() => {
    if (!frames || frames.length < 2 || !playing || scrubbing) {
      return;
    }
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % frames.length);
    }, 1000 / PREVIEW_FPS);
    return () => {
      clearInterval(timer);
    };
  }, [frames, playing, scrubbing]);

  const frame = frames?.[index];
  // Recording time per second of preview: the same for most recordings, larger for long ones
  // whose frames are spread out.
  const speedUp =
    frames && frames.length > 1
      ? ((frames[frames.length - 1]!.offsetSec - frames[0]!.offsetSec) / (frames.length - 1)) *
        PREVIEW_FPS
      : undefined;
  const src = frame?.url ?? recording.thumbnail;
  if (src == undefined && imageTopics.length === 0) {
    return null;
  }

  return (
    <Stack gap={0.5}>
      <div
        className={classes.screen}
        onMouseMove={(event) => {
          if (!frames || frames.length === 0) {
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          setScrubbing(true);
          setIndex(Math.min(frames.length - 1, Math.max(0, Math.floor(ratio * frames.length))));
        }}
        onMouseLeave={() => {
          setScrubbing(false);
        }}
      >
        {src != undefined && <img src={src} alt="" className={classes.image} />}
        {loading && <LinearProgress className={classes.loading} />}
      </div>
      {frames && frames.length > 1 && (
        <Stack direction="row" alignItems="center" gap={1}>
          <IconButton
            size="small"
            onClick={() => {
              setPlaying((value) => !value);
            }}
            aria-label={playing ? t("pausePreview") : t("playPreview")}
            title={playing ? t("pausePreview") : t("playPreview")}
          >
            {playing ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
          </IconButton>
          <Slider
            className={classes.seek}
            size="small"
            value={index}
            min={0}
            max={frames.length - 1}
            aria-label={t("previewPosition")}
            onChange={(_event, value) => {
              setPlaying(false);
              setIndex(value);
            }}
          />
          <Typography
            variant="caption"
            className={classes.time}
            sx={{
              color: "text.secondary",
            }}
          >
            {frame ? formatDuration(fromSec(frame.offsetSec)) : ""}
            {speedUp != undefined && ` · ${t("speedUp", { factor: Math.round(speedUp) })}`}
          </Typography>
        </Stack>
      )}
      {imageTopics.length > 1 && (
        <Select
          size="small"
          value={topic ?? ""}
          onChange={(event) => {
            setTopic(event.target.value);
          }}
        >
          {imageTopics.map((name) => (
            <MenuItem key={name} value={name}>
              {name}
            </MenuItem>
          ))}
        </Select>
      )}
      {error && (
        <Typography variant="caption" color="error">
          {t("previewFailed", { error: error.message })}
        </Typography>
      )}
    </Stack>
  );
}
