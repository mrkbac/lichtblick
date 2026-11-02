// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import CloseIcon from "@mui/icons-material/Close";
import { Button, IconButton, TextField, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { toSec } from "@lichtblick/rostime";
import Stack from "@lichtblick/suite-base/components/Stack";

import { CatalogRecording } from "./types";

const useStyles = makeStyles()((theme) => ({
  root: {
    width: 440,
    flexShrink: 0,
    minHeight: 0,
    borderLeft: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(0, 0, 0, 2),
    gap: theme.spacing(1.5),
  },
  name: {
    flex: 1,
    minWidth: 0,
  },
  thumbnail: {
    display: "block",
    width: "100%",
    borderRadius: theme.shape.borderRadius,
  },
  topics: {
    flex: 1,
    overflow: "auto",
    minHeight: 0,
  },
  topic: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    columnGap: theme.spacing(1),
    padding: theme.spacing(0.75, 0),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  numeric: {
    textAlign: "right",
    fontFeatureSettings: `"tnum"`,
  },
}));

export function RecordingDetails({
  recording,
  initialFilter = "",
  onOpen,
  onClose,
}: {
  recording: CatalogRecording;
  /** E.g. the `topic:` term of the catalog search, so matching topics show first. */
  initialFilter?: string;
  onOpen: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("catalog");
  const [filter, setFilter] = useState(initialFilter);

  const durationSec =
    recording.start && recording.end ? toSec(recording.end) - toSec(recording.start) : undefined;

  const topics = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (recording.topics ?? []).filter(
      (topic) =>
        topic.name.toLowerCase().includes(needle) || topic.schema.toLowerCase().includes(needle),
    );
  }, [recording.topics, filter]);

  return (
    <Stack className={classes.root}>
      <Stack direction="row" alignItems="center" gap={1}>
        <Typography variant="h5" noWrap className={classes.name}>
          {recording.name}
        </Typography>
        <IconButton
          size="small"
          onClick={onClose}
          aria-label={t("closeDetails")}
          title={t("closeDetails")}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
      {recording.thumbnail != undefined && (
        <img src={recording.thumbnail} alt="" className={classes.thumbnail} />
      )}
      <Button variant="contained" onClick={onOpen}>
        {t("openRecording")}
      </Button>
      <TextField
        size="small"
        value={filter}
        placeholder={t("searchTopics", {
          count: recording.topics?.length ?? 0,
        })}
        onChange={(event) => {
          setFilter(event.target.value);
        }}
      />
      <div className={classes.topics}>
        {topics.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {recording.topics ? t("noTopicMatches") : t("noTopics")}
          </Typography>
        )}
        {topics.map((topic) => (
          <div key={topic.name} className={classes.topic}>
            <Typography variant="body2" noWrap title={topic.name}>
              {topic.name}
            </Typography>
            <Typography variant="body2" className={classes.numeric}>
              {topic.messages?.toLocaleString() ?? "–"}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap title={topic.schema}>
              {topic.schema}
            </Typography>
            <Typography variant="caption" color="text.secondary" className={classes.numeric}>
              {topic.messages != undefined && durationSec != undefined && durationSec > 0
                ? t("hz", { hz: (topic.messages / durationSec).toFixed(1) })
                : ""}
            </Typography>
          </div>
        ))}
      </div>
    </Stack>
  );
}
