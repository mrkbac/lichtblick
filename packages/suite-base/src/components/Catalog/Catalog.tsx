// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { subtract } from "@foxglove/rostime";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Button,
  ButtonBase,
  Chip,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  TableSortLabel,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { formatByteSize } from "@lichtblick/den/format";
import Stack from "@lichtblick/suite-base/components/Stack";
import { formatDurationCompact } from "@lichtblick/suite-base/util/formatTime";
import { formatTimeAgo } from "@lichtblick/suite-base/util/recentSources";

import { AnimatedThumbnail } from "./AnimatedThumbnail";
import { CatalogEvents, formatCatalogTime } from "./CatalogEvents";
import { QuickFilters } from "./QuickFilters";
import { RecordingDetails } from "./RecordingDetails";
import {
  RecordingThumbnail,
  THUMB_WIDTH,
  formatStart,
  recordingCaption,
} from "./RecordingThumbnail";
import {
  CatalogSection,
  GROUP_SECTIONS,
  groupName,
  timelineBar,
  timelineRange,
  TimelineClock,
} from "./catalogViews";
import {
  CatalogSort,
  DEFAULT_CATALOG_SORT,
  SortKey,
  filterRecordings,
  sortRecordings,
} from "./search";
import { Bounds, boundsIntersect, pickTrack, trackBounds } from "./track";
import { CatalogBackend } from "./types";

// MapLibre is large; load it only when the map is shown.
const CatalogMap = lazy(async () => await import("./CatalogMap"));

const ROW_HEIGHT = 52;
const NARROW_LIST_WIDTH = 900;
const COLUMNS = `${THUMB_WIDTH}px minmax(0, 1fr) 210px 120px 100px 120px 80px`;
// With the details pane open (it lists messages and topics) or in a narrow window, those columns
// make room for names.
const COMPACT_COLUMNS = `${THUMB_WIDTH}px minmax(0, 1fr) 190px 110px 90px`;

const useStyles = makeStyles()((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing(1),
  },
  header: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing(1),
    minHeight: 30,
  },
  folderButton: {
    minWidth: 0,
    fontWeight: theme.typography.fontWeightBold,
  },
  folderName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 240,
  },
  spacer: {
    flex: 1,
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
  compactRow: {
    gridTemplateColumns: COMPACT_COLUMNS,
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
  timelineRow: {
    gridTemplateColumns: "minmax(100px, 1fr) minmax(0, 3fr)",
  },
  timelineTrack: {
    position: "relative",
    height: theme.spacing(1.5),
    backgroundColor: theme.palette.action.hover,
  },
  timelineBar: {
    position: "absolute",
    height: "100%",
    minWidth: 2,
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.primary.main,
  },
  numeric: {
    textAlign: "right",
    fontFeatureSettings: `"tnum"`,
  },
  grid: {
    flex: 1,
    minWidth: 0,
    overflow: "auto",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    alignContent: "start",
    gap: theme.spacing(2),
    paddingRight: theme.spacing(1),
  },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: theme.spacing(0.75),
    padding: theme.spacing(1),
    textAlign: "left",
    borderRadius: theme.spacing(1),
    border: `1px solid ${theme.palette.divider}`,
    "&:hover": { backgroundColor: theme.palette.action.hover },
  },
  selectedCard: {
    borderColor: theme.palette.primary.main,
    backgroundColor: theme.palette.action.selected,
  },
  cardThumbnail: {
    width: "100%",
    aspectRatio: "16 / 9",
  },
  emptyIcon: {
    fontSize: 48,
  },
  progress: {
    flex: 1,
    minWidth: 80,
  },
  message: {
    padding: theme.spacing(2),
  },
  dropZone: {
    flex: 1,
    minHeight: 0,
    borderRadius: theme.shape.borderRadius,
    outline: "2px dashed transparent",
    outlineOffset: theme.spacing(0.5),
  },
  dragging: {
    outlineColor: theme.palette.primary.main,
    backgroundColor: theme.palette.action.hover,
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

type Props = {
  folder: CatalogBackend;
  /** Search query, see `filterRecordings`. */
  query: string;
  /** When each file name was last opened, from the recent sources. */
  lastOpenedByName: ReadonlyMap<string, number>;
  /** Shows quick filter chips that edit the query. */
  onQueryChange?: (query: string) => void;
  /** Set by a page that shows the view switch itself; otherwise the catalog shows its own. */
  view?: "list" | "grid" | "map";
  /** The first view of the catalog's own switch. */
  initialView?: "list" | "grid" | "map";
  sections?: boolean;
  /** Set by a page that needs the table's order; otherwise the catalog keeps its own. */
  sort?: CatalogSort;
  onSortChange?: (sort: CatalogSort) => void;
};

/** Every recording of a catalog: a local folder, live recordings or a catalog URL. */
export default function Catalog({
  folder,
  query,
  lastOpenedByName,
  onQueryChange,
  view: viewProp,
  initialView = "list",
  sections = true,
  sort: sortProp,
  onSortChange,
}: Props): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t, i18n } = useTranslation("catalog");
  const { recordings, progress, error, open } = folder;

  const [selectedId, setSelectedId] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [localView, setView] = useState<"list" | "grid" | "map">(initialView);
  const [section, setSection] = useState<CatalogSection>("recordings");
  const [group, setGroup] = useState<string>();
  const [clock, setClock] = useState<TimelineClock>("wall");
  const view = section === "recordings" ? (viewProp ?? localView) : "list";
  const groupSection = GROUP_SECTIONS.find((value) => value === section);
  const browsingGroups = groupSection != undefined && group == undefined;
  const showList = view === "list" && !browsingGroups && section !== "events";
  const [gpsTopic, setGpsTopic] = useState<string>();
  const [area, setArea] = useState<Bounds>();
  const [localSort, setLocalSort] = useState(DEFAULT_CATALOG_SORT);
  const sort = sortProp ?? localSort;
  const setSort = onSortChange ?? setLocalSort;
  const scrollRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const matching = filterRecordings(recordings, browsingGroups ? "" : query).filter((r) => {
      if (groupSection && group != undefined && groupName(r, groupSection) !== group) {
        return false;
      }
      if (!area || section !== "recordings") {
        return true;
      }
      const bounds = trackBounds(pickTrack(r.tracks, gpsTopic)?.points ?? []);
      return bounds != undefined && boundsIntersect(bounds, area);
    });
    return sortRecordings(matching, sort);
  }, [recordings, query, sort, area, gpsTopic, group, groupSection, section, browsingGroups]);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    if (groupSection) {
      for (const recording of shown) {
        const name = groupName(recording, groupSection);
        if (name?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) === true) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b, i18n.language));
  }, [shown, groupSection, query, i18n.language]);

  const absoluteRange = useMemo(
    () => (section === "timeline" ? timelineRange(shown, "wall") : undefined),
    [section, shown],
  );
  const relativeRange = useMemo(
    () => (section === "timeline" ? timelineRange(shown, "relative") : undefined),
    [section, shown],
  );
  const range =
    clock === "relative" ? (relativeRange ?? absoluteRange) : (absoluteRange ?? relativeRange);
  const timelineRows = useMemo(
    () =>
      section === "timeline" ? shown.filter((r) => timelineBar(r, range) != undefined) : shown,
    [section, shown, range],
  );

  const gpsTopics = useMemo(
    () =>
      [...new Set(recordings.flatMap((r) => r.tracks?.map((track) => track.topic) ?? []))].sort(),
    [recordings],
  );

  const selected = recordings.find((r) => r.id === selectedId);
  const loadSelectedPreview = useMemo(
    () =>
      selected?.source.type === "local-file" || selected?.previews != undefined
        ? async (topic: string) => await folder.loadPreview(selected, topic)
        : undefined,
    [folder, selected],
  );
  // Below this width the full set of columns squeezes names to nothing.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setNarrow((entry?.contentRect.width ?? Infinity) < NARROW_LIST_WIDTH);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [showList, folder.name]);
  const compact = selected != undefined || narrow;
  const topicTerm = /(?:^|\s)topic:(\S+)/i.exec(query)?.[1];

  const virtualizer = useVirtualizer({
    count: timelineRows.length,
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
        setSort({ key, desc: sort.key === key ? !sort.desc : key !== "name" });
      }}
    >
      {label}
    </TableSortLabel>
  );

  // A browser may show a folder picker yet refuse to read what was picked; offer the classic
  // upload picker, which reads the files directly.
  const errorAlert = error && (
    <Alert
      severity={folder.pickerClosed === true ? "info" : "error"}
      action={
        folder.accessDenied === true || folder.pickerClosed === true ? (
          <Button color="inherit" size="small" onClick={folder.pickFolderWithInput}>
            {t("useUploadPicker")}
          </Button>
        ) : undefined
      }
    >
      {folder.accessDenied === true
        ? t("folderAccessDenied")
        : folder.pickerClosed === true
          ? t("folderPickerClosed")
          : error}
    </Alert>
  );

  // Dropping a folder opens it, also where the browser can't show a folder picker.
  const dropProps = {
    onDragOver: (event: React.DragEvent) => {
      if (!folder.dropFolder) {
        return;
      }
      if ([...event.dataTransfer.items].some((item) => item.kind === "file")) {
        event.preventDefault();
        event.stopPropagation();
        setDragging(true);
      }
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setDragging(false);
      }
    },
    onDrop: (event: React.DragEvent) => {
      setDragging(false);
      // Only a folder is ours; dropped files go on to open as a data source.
      if (folder.dropFolder?.(event.dataTransfer) === true) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };

  if (folder.name == undefined) {
    return (
      <Stack className={cx(classes.dropZone, { [classes.dragging]: dragging })} {...dropProps}>
        <Stack className={classes.empty}>
          <FolderOpenOutlinedIcon color="primary" className={classes.emptyIcon} />
          <Typography variant="h5">{t("emptyTitle")}</Typography>
          <Typography variant="body2" color="textSecondary">
            {t("emptyDescription")}
          </Typography>
          <Stack direction="row" gap={1}>
            <Button variant="contained" onClick={() => void folder.pickFolder?.()}>
              {t("openFolder")}
            </Button>
            {folder.lastFolder && (
              <Button variant="outlined" onClick={() => void folder.reopenLastFolder?.()}>
                {t("reopenFolder", { name: folder.lastFolder.name })}
              </Button>
            )}
          </Stack>
          {errorAlert}
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack
      className={cx(classes.root, classes.dropZone, { [classes.dragging]: dragging })}
      {...dropProps}
    >
      {/* One line: folder, count, filters, then the view's controls. */}
      <div className={classes.header}>
        {folder.pickFolder ? (
          <Tooltip title={t("changeFolder")}>
            <Button
              size="small"
              color="inherit"
              startIcon={<FolderOpenOutlinedIcon fontSize="small" />}
              className={classes.folderButton}
              onClick={() => void folder.pickFolder?.()}
            >
              <span className={classes.folderName}>{folder.name}</span>
            </Button>
          </Tooltip>
        ) : (
          <Typography variant="subtitle2" noWrap className={classes.folderName}>
            {folder.name}
          </Typography>
        )}
        <Typography variant="body2" noWrap color="textSecondary">
          {query.trim() === "" && !area
            ? t("recordingCount", { count: recordings.length })
            : t("shownCount", {
                shown: shown.length,
                total: recordings.length,
              })}
        </Typography>
        {progress && (
          <>
            <Typography variant="body2" noWrap color="textSecondary">
              {t("indexing", progress)}
            </Typography>
            <LinearProgress
              className={classes.progress}
              variant="determinate"
              value={progress.total === 0 ? 100 : (progress.done / progress.total) * 100}
            />
          </>
        )}
        {onQueryChange && (section === "recordings" || section === "timeline") && (
          <QuickFilters recordings={recordings} query={query} onQueryChange={onQueryChange} />
        )}
        {area && section === "recordings" && (
          <Chip
            size="small"
            color="primary"
            label={t("inMapArea")}
            onDelete={() => {
              setArea(undefined);
            }}
          />
        )}
        <div className={classes.spacer} />
        {view === "map" && gpsTopics.length > 1 && (
          <Select
            size="small"
            value={gpsTopic ?? ""}
            displayEmpty
            onChange={(event) => {
              setGpsTopic(event.target.value === "" ? undefined : event.target.value);
            }}
          >
            <MenuItem value="">{t("gpsTopicAuto")}</MenuItem>
            {gpsTopics.map((topic) => (
              <MenuItem key={topic} value={topic}>
                {topic}
              </MenuItem>
            ))}
          </Select>
        )}
        {viewProp == undefined && section === "recordings" && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_event, value: "list" | "grid" | "map" | null) => {
              if (value) {
                setView(value);
              }
            }}
          >
            <ToggleButton value="list">{t("listView")}</ToggleButton>
            <ToggleButton value="grid">{t("gridView")}</ToggleButton>
            <ToggleButton value="map">{t("mapView")}</ToggleButton>
          </ToggleButtonGroup>
        )}
        <Tooltip title={t("rescanDescription")}>
          <span>
            <IconButton
              size="small"
              aria-label={t("rescan")}
              disabled={progress != undefined || folder.rescan == undefined}
              onClick={() => void folder.rescan?.()}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </div>
      {sections && (
        <div className={classes.header}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={section}
            aria-label={t("catalogSections")}
            onChange={(_event, value: CatalogSection | null) => {
              if (value) {
                setSection(value);
                setGroup(undefined);
                setSelectedId(undefined);
              }
            }}
          >
            <ToggleButton value="recordings">{t("recordings")}</ToggleButton>
            <ToggleButton value="timeline">{t("timeline")}</ToggleButton>
            <ToggleButton value="devices">{t("devices")}</ToggleButton>
            <ToggleButton value="events">{t("events")}</ToggleButton>
            <ToggleButton value="datasets">{t("datasets")}</ToggleButton>
            {recordings.some((r) => r.session) && (
              <ToggleButton value="sessions">{t("sessions")}</ToggleButton>
            )}
            {recordings.some((r) => r.episode) && (
              <ToggleButton value="episodes">{t("episodes")}</ToggleButton>
            )}
          </ToggleButtonGroup>
          {group != undefined && (
            <Chip
              label={group}
              onDelete={() => {
                setGroup(undefined);
                setSelectedId(undefined);
              }}
            />
          )}
          {section === "timeline" && absoluteRange && relativeRange && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={clock}
              aria-label={t("timelineClock")}
              onChange={(_event, value: TimelineClock | null) => {
                if (value != undefined) {
                  setClock(value);
                }
              }}
            >
              <ToggleButton value="wall">{t("wallClockTime")}</ToggleButton>
              <ToggleButton value="relative">{t("relativeTime")}</ToggleButton>
            </ToggleButtonGroup>
          )}
        </div>
      )}
      {errorAlert}
      <Stack direction="row" className={classes.body}>
        {section === "events" ? (
          <CatalogEvents
            recordings={recordings}
            query={query}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ) : browsingGroups ? (
          <List dense disablePadding className={classes.scroller}>
            {groups.length === 0 && !progress && (
              <Typography color="textSecondary">{t("noGroups")}</Typography>
            )}
            {groups.map(([name, count]) => (
              <ListItemButton
                key={name}
                onClick={() => {
                  setGroup(name);
                  onQueryChange?.("");
                }}
              >
                <ListItemText primary={name} secondary={t("recordingCount", { count })} />
              </ListItemButton>
            ))}
          </List>
        ) : view === "map" ? (
          <Suspense fallback={<div className={classes.list} />}>
            <CatalogMap
              recordings={shown}
              gpsTopic={gpsTopic}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onSearchArea={setArea}
            />
          </Suspense>
        ) : view === "grid" ? (
          <div className={classes.grid}>
            {shown.length === 0 && progress == undefined && error == undefined && (
              <Typography className={classes.message} color="textSecondary">
                {recordings.length === 0 ? t("noRecordings") : t("noMatches")}
              </Typography>
            )}
            {shown.map((r) => (
              <ButtonBase
                key={r.id}
                className={cx(classes.card, { [classes.selectedCard]: r.id === selectedId })}
                onClick={() => {
                  setSelectedId(r.id);
                }}
                onDoubleClick={() => void open(r)}
              >
                <AnimatedThumbnail recording={r} className={classes.cardThumbnail} scrub />
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
                <Typography variant="caption" noWrap color="textSecondary">
                  {recordingCaption(r)}
                </Typography>
              </ButtonBase>
            ))}
          </div>
        ) : (
          <Stack className={classes.list}>
            {section === "timeline" ? (
              <div className={cx(classes.row, classes.headRow, classes.timelineRow)}>
                {sortLabel("start", t("start"))}
                {range && (
                  <Stack direction="row" justifyContent="space-between" gap={1}>
                    <Typography variant="caption">{formatCatalogTime(range.start)}</Typography>
                    <Typography variant="caption">{formatCatalogTime(range.end)}</Typography>
                  </Stack>
                )}
              </div>
            ) : (
              <div className={cx(classes.row, classes.headRow, { [classes.compactRow]: compact })}>
                <span />
                {sortLabel("name", t("name"))}
                {sortLabel("start", t("start"))}
                {sortLabel("duration", t("duration"))}
                {sortLabel("size", t("size"))}
                {!compact && sortLabel("messages", t("messages"))}
                {!compact && sortLabel("topics", t("topics"))}
              </div>
            )}
            <div ref={scrollRef} className={classes.scroller}>
              {timelineRows.length === 0 && progress == undefined && error == undefined && (
                <Typography className={classes.message} color="textSecondary">
                  {section === "timeline"
                    ? t("noRecordingTimes")
                    : recordings.length === 0
                      ? t("noRecordings")
                      : t("noMatches")}
                </Typography>
              )}
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  position: "relative",
                }}
              >
                {virtualizer.getVirtualItems().map((item) => {
                  const r = timelineRows[item.index]!;
                  if (section === "timeline") {
                    return (
                      <ButtonBase
                        key={r.id}
                        className={cx(classes.row, classes.bodyRow, classes.timelineRow, {
                          [classes.selectedRow]: r.id === selectedId,
                        })}
                        style={{ transform: `translateY(${item.start}px)` }}
                        onClick={() => {
                          setSelectedId(r.id);
                        }}
                        onDoubleClick={() => void open(r)}
                      >
                        <Typography noWrap variant="body2" title={r.name}>
                          {r.name}
                        </Typography>
                        <Tooltip title={recordingCaption(r)}>
                          <div className={classes.timelineTrack}>
                            <div className={classes.timelineBar} style={timelineBar(r, range)} />
                          </div>
                        </Tooltip>
                      </ButtonBase>
                    );
                  }
                  const path = r.source.type === "local-file" ? r.source.path : r.source.url;
                  // Recents know files by their file name; a live recording's title is its machine.
                  const lastOpened = lastOpenedByName.get(
                    r.source.type === "local-file"
                      ? (r.source.path.split("/").pop() ?? r.name)
                      : r.name,
                  );
                  const caption = [
                    lastOpened != undefined
                      ? t("openedAgo", {
                          ago: formatTimeAgo(lastOpened, Date.now(), i18n.language),
                        })
                      : undefined,
                    r.description ?? (path !== r.name ? path : undefined),
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <ButtonBase
                      key={r.id}
                      className={cx(classes.row, classes.bodyRow, {
                        [classes.compactRow]: compact,
                        [classes.selectedRow]: r.id === selectedId,
                      })}
                      style={{ transform: `translateY(${item.start}px)` }}
                      onClick={() => {
                        setSelectedId(r.id);
                      }}
                      onDoubleClick={() => void open(r)}
                    >
                      <RecordingThumbnail recording={r} />
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
                          <Typography variant="caption" noWrap color="textSecondary">
                            {caption}
                          </Typography>
                        )}
                      </Stack>
                      <Typography variant="body2" noWrap>
                        {formatStart(r)}
                      </Typography>
                      <Typography variant="body2" className={classes.numeric}>
                        {r.start && r.end ? formatDurationCompact(subtract(r.end, r.start)) : "–"}
                      </Typography>
                      <Typography variant="body2" className={classes.numeric}>
                        {r.size != undefined ? formatByteSize(r.size) : "–"}
                      </Typography>
                      {!compact && (
                        <>
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
                        </>
                      )}
                    </ButtonBase>
                  );
                })}
              </div>
            </div>
          </Stack>
        )}
        {selected && (
          <RecordingDetails
            key={`${selected.id}|${topicTerm ?? ""}`}
            recording={selected}
            initialFilter={topicTerm}
            loadPreview={loadSelectedPreview}
            onOpen={() => void open(selected)}
            actions={folder.recordingActions?.(selected)}
            onClose={() => {
              setSelectedId(undefined);
            }}
          />
        )}
      </Stack>
    </Stack>
  );
}
