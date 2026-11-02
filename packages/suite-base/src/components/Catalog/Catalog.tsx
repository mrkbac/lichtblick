// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { subtract, toSec } from "@foxglove/rostime";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Button,
  ButtonBase,
  Chip,
  LinearProgress,
  TableSortLabel,
  Tooltip,
  Typography,
} from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as _ from "lodash-es";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { formatByteSize } from "@lichtblick/den/format";
import Stack from "@lichtblick/suite-base/components/Stack";
import { format, formatDuration } from "@lichtblick/suite-base/util/formatTime";
import { formatTimeAgo } from "@lichtblick/suite-base/util/recentSources";
import { formatTimeRaw, isAbsoluteTime } from "@lichtblick/suite-base/util/time";

import { RecordingDetails } from "./RecordingDetails";
import { filterRecordings } from "./search";
import { CatalogRecording } from "./types";
import { CatalogFolder } from "./useCatalogFolder";

const ROW_HEIGHT = 52;
const THUMB_WIDTH = 72;
const COLUMNS = `${THUMB_WIDTH}px minmax(0, 1fr) 210px 120px 100px 120px 80px`;

type SortKey = "name" | "start" | "duration" | "size" | "messages" | "topics";

function durationSec(r: CatalogRecording): number | undefined {
  return r.start && r.end ? toSec(r.end) - toSec(r.start) : undefined;
}

const SORT_VALUES: Record<SortKey, (r: CatalogRecording) => string | number | undefined> = {
  name: (r) => r.name.toLowerCase(),
  start: (r) => (r.start ? toSec(r.start) : undefined),
  duration: durationSec,
  size: (r) => r.size,
  messages: (r) => r.messages,
  topics: (r) => r.topics?.length,
};

function sortRecordings(
  recordings: CatalogRecording[],
  { key, desc }: { key: SortKey; desc: boolean },
): CatalogRecording[] {
  const value = SORT_VALUES[key];
  const [known, unknown] = _.partition(recordings, (r) => value(r) != undefined);
  const sorted = _.sortBy(known, value);
  return [...(desc ? sorted.reverse() : sorted), ...unknown];
}

const useStyles = makeStyles()((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing(1),
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    alignItems: "center",
    gap: theme.spacing(2),
    padding: theme.spacing(0, 1.5),
    width: "100%",
    textAlign: "left",
  },
  headRow: {
    borderBottom: `1px solid ${theme.palette.divider}`,
    paddingBottom: theme.spacing(1),
  },
  bodyRow: {
    position: "absolute",
    top: 0,
    left: 0,
    height: ROW_HEIGHT,
    borderBottom: `1px solid ${theme.palette.divider}`,
    "&:hover": { backgroundColor: theme.palette.action.hover },
  },
  selectedRow: {
    backgroundColor: theme.palette.action.selected,
  },
  body: {
    flex: 1,
    minHeight: 0,
    paddingBottom: theme.spacing(2),
  },
  list: {
    flex: 1,
    minWidth: 0,
  },
  scroller: {
    flex: 1,
    overflow: "auto",
    minHeight: 0,
  },
  numeric: {
    textAlign: "right",
    fontFeatureSettings: `"tnum"`,
  },
  thumbnail: {
    display: "block",
    width: THUMB_WIDTH,
    height: (THUMB_WIDTH * 9) / 16,
    objectFit: "cover",
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.action.hover,
  },
  preview: {
    display: "block",
    width: 240,
    borderRadius: theme.shape.borderRadius,
  },
  emptyIcon: {
    fontSize: 48,
  },
  progress: {
    flex: 1,
  },
  message: {
    padding: theme.spacing(2),
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    gap: theme.spacing(1.5),
    maxWidth: 520,
    margin: "0 auto",
    padding: theme.spacing(4, 0),
  },
}));

function formatStart(r: CatalogRecording): string {
  if (!r.start) {
    return "–";
  }
  return isAbsoluteTime(r.start) ? format(r.start) : formatTimeRaw(r.start);
}

type Props = {
  folder: CatalogFolder;
  /** Search query, see `filterRecordings`. */
  query: string;
  /** When each file name was last opened, from the recent sources. */
  lastOpenedByName: ReadonlyMap<string, number>;
};

/** The catalog section of the start page: every recording in a local folder. */
export default function Catalog({ folder, query, lastOpenedByName }: Props): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t, i18n } = useTranslation("catalog");
  const { recordings, progress, error, open } = folder;

  const [selectedId, setSelectedId] = useState<string>();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "start",
    desc: true,
  });
  const scrollRef = useRef<HTMLDivElement>(ReactNull);

  const shown = useMemo(
    () => sortRecordings(filterRecordings(recordings, query), sort),
    [recordings, query, sort],
  );

  const selected = recordings.find((r) => r.id === selectedId);
  const topicTerm = /(?:^|\s)topic:(\S+)/i.exec(query)?.[1];

  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const sortLabel = (key: SortKey, label: string) => (
    <TableSortLabel
      className={key === "name" || key === "start" ? undefined : classes.numeric}
      active={sort.key === key}
      direction={sort.key === key && sort.desc ? "desc" : "asc"}
      onClick={() => {
        setSort((prev) => ({
          key,
          desc: prev.key === key ? !prev.desc : key !== "name",
        }));
      }}
    >
      {label}
    </TableSortLabel>
  );

  if (folder.name == undefined) {
    return (
      <Stack className={classes.empty}>
        <FolderOpenOutlinedIcon color="primary" className={classes.emptyIcon} />
        <Typography variant="h5">{t("emptyTitle")}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t("emptyDescription")}
        </Typography>
        <Stack direction="row" gap={1}>
          <Button variant="contained" onClick={() => void folder.pickFolder()}>
            {t("openFolder")}
          </Button>
          {folder.lastFolder && (
            <Button variant="outlined" onClick={() => void folder.reopenLastFolder()}>
              {t("reopenFolder", { name: folder.lastFolder.name })}
            </Button>
          )}
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    );
  }

  return (
    <Stack className={classes.root}>
      <div className={classes.header}>
        <Typography variant="h5" noWrap>
          {t("catalog")}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap className={classes.title}>
          {folder.name}
        </Typography>
        <Tooltip title={t("rescanDescription")}>
          <span>
            <Button
              size="small"
              color="inherit"
              startIcon={<RefreshIcon />}
              disabled={progress != undefined || folder.rescan == undefined}
              onClick={() => void folder.rescan?.()}
            >
              {t("rescan")}
            </Button>
          </span>
        </Tooltip>
        <Button size="small" color="inherit" onClick={() => void folder.pickFolder()}>
          {t("changeFolder")}
        </Button>
      </div>
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" alignItems="center" gap={2}>
        <Typography variant="body2" color="text.secondary">
          {query.trim() === ""
            ? t("recordingCount", { count: recordings.length })
            : t("shownCount", {
                shown: shown.length,
                total: recordings.length,
              })}
        </Typography>
        {progress && (
          <>
            <Typography variant="body2" color="text.secondary">
              {t("indexing", progress)}
            </Typography>
            <LinearProgress
              className={classes.progress}
              variant="determinate"
              value={progress.total === 0 ? 100 : (progress.done / progress.total) * 100}
            />
          </>
        )}
      </Stack>
      <Stack direction="row" className={classes.body}>
        <Stack className={classes.list}>
          <div className={cx(classes.row, classes.headRow)}>
            <span />
            {sortLabel("name", t("name"))}
            {sortLabel("start", t("start"))}
            {sortLabel("duration", t("duration"))}
            {sortLabel("size", t("size"))}
            {sortLabel("messages", t("messages"))}
            {sortLabel("topics", t("topics"))}
          </div>
          <div ref={scrollRef} className={classes.scroller}>
            {shown.length === 0 && progress == undefined && (
              <Typography color="text.secondary" className={classes.message}>
                {recordings.length === 0 ? t("noRecordings") : t("noMatches")}
              </Typography>
            )}
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const r = shown[item.index]!;
                const path = r.source.type === "local-file" ? r.source.path : r.source.url;
                const lastOpened = lastOpenedByName.get(r.name);
                const caption = [
                  lastOpened != undefined
                    ? t("openedAgo", {
                        ago: formatTimeAgo(lastOpened, Date.now(), i18n.language),
                      })
                    : undefined,
                  path !== r.name ? path : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <ButtonBase
                    key={r.id}
                    className={cx(classes.row, classes.bodyRow, {
                      [classes.selectedRow]: r.id === selectedId,
                    })}
                    style={{ transform: `translateY(${item.start}px)` }}
                    onClick={() => {
                      setSelectedId(r.id);
                    }}
                    onDoubleClick={() => void open(r)}
                  >
                    {r.thumbnail != undefined ? (
                      <Tooltip
                        placement="right"
                        title={<img src={r.thumbnail} alt="" className={classes.preview} />}
                      >
                        <img
                          src={r.thumbnail}
                          alt=""
                          loading="lazy"
                          className={classes.thumbnail}
                        />
                      </Tooltip>
                    ) : (
                      <span className={classes.thumbnail} />
                    )}
                    <Stack style={{ minWidth: 0 }}>
                      <Stack direction="row" alignItems="center" gap={1} style={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap>
                          {r.name}
                        </Typography>
                        {r.error != undefined && (
                          <Tooltip title={r.error}>
                            <Chip size="small" color="error" label={t("error")} />
                          </Tooltip>
                        )}
                        {r.noSummary === true && (
                          <Tooltip title={t("noSummaryDescription")}>
                            <Chip size="small" label={t("noSummary")} />
                          </Tooltip>
                        )}
                      </Stack>
                      {caption !== "" && (
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {caption}
                        </Typography>
                      )}
                    </Stack>
                    <Typography variant="body2" noWrap>
                      {formatStart(r)}
                    </Typography>
                    <Typography variant="body2" className={classes.numeric}>
                      {r.start && r.end ? formatDuration(subtract(r.end, r.start)) : "–"}
                    </Typography>
                    <Typography variant="body2" className={classes.numeric}>
                      {r.size != undefined ? formatByteSize(r.size) : "–"}
                    </Typography>
                    <Typography variant="body2" className={classes.numeric}>
                      {r.messages?.toLocaleString() ?? "–"}
                    </Typography>
                    <Tooltip
                      title={r.topics
                        ?.slice(0, 30)
                        .map((topic) => topic.name)
                        .join("\n")}
                      slotProps={{
                        tooltip: { sx: { whiteSpace: "pre-line" } },
                      }}
                    >
                      <Typography variant="body2" className={classes.numeric}>
                        {r.topics?.length ?? "–"}
                      </Typography>
                    </Tooltip>
                  </ButtonBase>
                );
              })}
            </div>
          </div>
        </Stack>
        {selected && (
          <RecordingDetails
            key={`${selected.id}|${topicTerm ?? ""}`}
            recording={selected}
            initialFilter={topicTerm}
            onOpen={() => void open(selected)}
            onClose={() => {
              setSelectedId(undefined);
            }}
          />
        )}
      </Stack>
    </Stack>
  );
}
