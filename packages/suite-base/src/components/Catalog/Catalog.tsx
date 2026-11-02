// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { subtract, toSec } from "@foxglove/rostime";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Button,
  ButtonBase,
  Chip,
  IconButton,
  LinearProgress,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsync } from "react-use";
import { makeStyles } from "tss-react/mui";

import { formatByteSize } from "@lichtblick/den/format";
import Stack from "@lichtblick/suite-base/components/Stack";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { format, formatDuration } from "@lichtblick/suite-base/util/formatTime";
import { formatTimeRaw, isAbsoluteTime } from "@lichtblick/suite-base/util/time";

import { RecordingDetails } from "./RecordingDetails";
import {
  FolderFile,
  indexFiles,
  listDirectory,
  listInputFiles,
  loadLastFolder,
  saveLastFolder,
} from "./indexFolder";
import { filterRecordings } from "./search";
import { CatalogRecording } from "./types";

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
    height: "100%",
    padding: theme.spacing(3, 4, 0),
    gap: theme.spacing(2),
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    // Leave room for the dialog's close button.
    paddingRight: theme.spacing(6),
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
    fontSize: 64,
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
    gap: theme.spacing(2),
    maxWidth: 520,
    margin: "0 auto",
  },
}));

function formatStart(r: CatalogRecording): string {
  if (!r.start) {
    return "–";
  }
  return isAbsoluteTime(r.start) ? format(r.start) : formatTimeRaw(r.start);
}

export default function Catalog(): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("catalog");
  const { selectSource } = usePlayerSelection();
  const { dialogActions } = useWorkspaceActions();

  const [folderName, setFolderName] = useState<string>();
  const [relist, setRelist] = useState<() => Promise<FolderFile[]>>();
  const [files, setFiles] = useState<FolderFile[]>([]);
  const [recordings, setRecordings] = useState<CatalogRecording[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "start",
    desc: true,
  });
  const scanIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(ReactNull);
  const scrollRef = useRef<HTMLDivElement>(ReactNull);

  const { value: lastFolder } = useAsync(loadLastFolder, []);

  const scan = useCallback(
    async (
      name: string,
      list: () => Promise<FolderFile[]>,
      { retryErrors = false }: { retryErrors?: boolean } = {},
    ) => {
      const scanId = ++scanIdRef.current;
      const isStale = () => scanId !== scanIdRef.current;
      setFolderName(name);
      setRelist(() => list);
      setError(undefined);
      try {
        const folderFiles = await list();
        if (isStale()) {
          return;
        }
        setFiles(folderFiles);
        setRecordings([]);
        setProgress({ done: 0, total: folderFiles.length });
        const ready: CatalogRecording[] = [];
        const flush = _.throttle(() => {
          if (!isStale()) {
            setRecordings([...ready]);
            setProgress({ done: ready.length, total: folderFiles.length });
          }
        }, 250);
        const results = await indexFiles(folderFiles, {
          retryErrors,
          isCancelled: isStale,
          onRecording: (recording) => {
            ready.push(recording);
            flush();
          },
        });
        flush.cancel();
        if (!isStale()) {
          setRecordings(results);
          setProgress(undefined);
        }
      } catch (err: unknown) {
        if (!isStale()) {
          setError(String(err));
          setProgress(undefined);
        }
      }
    },
    [],
  );

  const openDirectory = useCallback(
    async (dir: FileSystemDirectoryHandle) => {
      await scan(dir.name, async () => await listDirectory(dir));
    },
    [scan],
  );

  // Reopen the last folder without a click when the browser still grants access, e.g. when
  // coming back to the catalog after opening a recording.
  useEffect(() => {
    if (!lastFolder) {
      return;
    }
    void (async () => {
      if ((await lastFolder.queryPermission({ mode: "read" })) === "granted") {
        await openDirectory(lastFolder);
      }
    })();
  }, [lastFolder, openDirectory]);

  const pickFolder = useCallback(async () => {
    if (!("showDirectoryPicker" in window)) {
      inputRef.current?.click();
      return;
    }
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await window.showDirectoryPicker({ mode: "read" });
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(String(err));
      }
      return;
    }
    // Remembering the folder is a convenience; open it even if that fails.
    await saveLastFolder(dir).catch((err: unknown) => {
      console.warn("Failed to remember the catalog folder", err);
    });
    await openDirectory(dir);
  }, [openDirectory]);

  const reopenLastFolder = useCallback(async () => {
    if (lastFolder && (await lastFolder.requestPermission({ mode: "read" })) === "granted") {
      await openDirectory(lastFolder);
    }
  }, [lastFolder, openDirectory]);

  const onInputFiles = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = [...(event.target.files ?? [])];
      const name = fileList[0]?.webkitRelativePath.split("/")[0] ?? "";
      await scan(name, async () => listInputFiles(fileList));
    },
    [scan],
  );

  const open = useCallback(
    async (recording: CatalogRecording) => {
      const { source } = recording;
      switch (source.type) {
        case "local-file": {
          const file = files.find((f) => f.path === source.path);
          if (!file) {
            return;
          }
          selectSource(
            "mcap-local-file",
            file.handle
              ? { type: "file", handles: [file.handle] }
              : { type: "file", files: [await file.getFile()] },
          );
          break;
        }
        case "remote-file":
        case "foxglove-websocket":
          selectSource(source.type, {
            type: "connection",
            params: { url: source.url },
          });
          break;
      }
    },
    [files, selectSource],
  );

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

  const folderInput = (
    <input
      ref={inputRef}
      type="file"
      hidden
      multiple
      // @ts-expect-error webkitdirectory is not in React's input attributes
      webkitdirectory=""
      onChange={onInputFiles}
    />
  );

  if (folderName == undefined) {
    return (
      <Stack className={classes.root}>
        <div className={classes.header}>
          <IconButton
            onClick={() => {
              dialogActions.dataSource.open("start");
            }}
            title={t("back")}
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h3" className={classes.title}>
            {t("catalog")}
          </Typography>
        </div>
        <Stack className={classes.empty}>
          <FolderOpenOutlinedIcon color="primary" className={classes.emptyIcon} />
          <Typography variant="h4">{t("emptyTitle")}</Typography>
          <Typography color="text.secondary">{t("emptyDescription")}</Typography>
          <Stack direction="row" gap={1}>
            <Button variant="contained" onClick={() => void pickFolder()}>
              {t("openFolder")}
            </Button>
            {lastFolder && (
              <Button variant="outlined" onClick={() => void reopenLastFolder()}>
                {t("reopenFolder", { name: lastFolder.name })}
              </Button>
            )}
          </Stack>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
        {folderInput}
      </Stack>
    );
  }

  return (
    <Stack className={classes.root}>
      <div className={classes.header}>
        <IconButton
          onClick={() => {
            dialogActions.dataSource.open("start");
          }}
          title={t("back")}
        >
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h3" noWrap className={classes.title}>
          {folderName}
        </Typography>
        <Tooltip title={t("rescanDescription")}>
          <span>
            <Button
              startIcon={<RefreshIcon />}
              disabled={progress != undefined || relist == undefined}
              onClick={() => relist && void scan(folderName, relist, { retryErrors: true })}
            >
              {t("rescan")}
            </Button>
          </span>
        </Tooltip>
        <Button variant="outlined" onClick={() => void pickFolder()}>
          {t("openFolder")}
        </Button>
      </div>
      <Stack gap={0.5}>
        <TextField
          autoFocus
          fullWidth
          size="small"
          value={query}
          placeholder={t("searchPlaceholder")}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <Typography variant="caption" color="text.secondary">
          {t("searchHelp")}
        </Typography>
      </Stack>
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
                      {path !== r.name && (
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {path}
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
      {folderInput}
    </Stack>
  );
}
