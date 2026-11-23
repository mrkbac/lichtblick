// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import {
  Button,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useImperativeHandle, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Catalog from "@lichtblick/suite-base/components/Catalog/Catalog";
import {
  RecordingThumbnail,
  recordingCaption,
} from "@lichtblick/suite-base/components/Catalog/RecordingThumbnail";
import { filterRecordings } from "@lichtblick/suite-base/components/Catalog/search";
import { CatalogRecording } from "@lichtblick/suite-base/components/Catalog/types";
import { useCatalogFolder } from "@lichtblick/suite-base/components/Catalog/useCatalogFolder";
import DontShowThisAgainCheckbox from "@lichtblick/suite-base/components/DataSourceDialog/DontShowThisAgainCheckbox";
import {
  OpenUrlInput,
  START_ADDRESS_INPUT_ID,
} from "@lichtblick/suite-base/components/DataSourceDialog/OpenUrlInput";
import {
  DEFAULT_CATALOG,
  SavedCatalogs,
  useSavedCatalogs,
} from "@lichtblick/suite-base/components/DataSourceDialog/SavedCatalogs";
import { useStyles } from "@lichtblick/suite-base/components/DataSourceDialog/index.style";
import { LiveRecordingsList } from "@lichtblick/suite-base/components/LiveRecordingsList";
import { usePanelGuideStore } from "@lichtblick/suite-base/components/PanelDocs/PanelGuide";
import { RecentSourceLabel } from "@lichtblick/suite-base/components/RecentSourceLabel";
import Stack from "@lichtblick/suite-base/components/Stack";
import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";
import {
  RecentSource,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { splitRecentTitle } from "@lichtblick/suite-base/util/recentSources";

// Number of recents listed on the All tab, unless searching
const RECENTS_PREVIEW_COUNT = 5;

export type StartHandle = { focusAddress: () => void };

type View = "all" | "catalog" | "recent" | "recordings" | "live";
type Kind = "all" | "file" | "remote" | "live";

function recentKind(recent: RecentSource): Exclude<Kind, "all"> {
  if (recent.type === "file") {
    return "file";
  }
  return recent.sourceId === "remote-file" ? "remote" : "live";
}

/** Local file recents carry the file name as title, as do catalog recordings. */
function catalogMatch(
  recent: RecentSource,
  catalogByName: ReadonlyMap<string, CatalogRecording>,
): CatalogRecording | undefined {
  return recent.type === "file" ? catalogByName.get(recent.title) : undefined;
}

/**
 * The start page: open anything (URL, files, folder), and search recent sources and the
 * recordings of a local folder in one place.
 */
export default function Start({ ref }: { ref?: React.Ref<StartHandle> }): React.JSX.Element {
  const {
    availableSources,
    recentSources,
    selectRecent,
    removeRecent,
    togglePinRecent,
    clearRecents,
  } = usePlayerSelection();
  const { classes } = useStyles();
  const { t } = useTranslation("openDialog");
  const { dialogActions } = useWorkspaceActions();
  const folder = useCatalogFolder();

  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  useImperativeHandle(
    ref,
    () => ({
      focusAddress() {
        if (view === "live") {
          setView("all");
        } else {
          document.getElementById(START_ADDRESS_INPUT_ID)?.focus();
        }
      },
    }),
    [view],
  );
  const [kindFilter, setKind] = useState<Kind>("all");
  // The kind filter belongs to the Recent tab; All shows every kind.
  const kind = view === "recent" ? kindFilter : "all";
  const [sources, setSources] = useSavedCatalogs();
  const [selectedCatalog, setSelectedCatalog] = useState(
    () => sources.find((source) => source.hidden !== true)?.id ?? "",
  );
  const [visitedCatalogs, setVisitedCatalogs] = useState<ReadonlySet<string>>(() => new Set());
  const selectCatalog = (id: string) => {
    setSelectedCatalog(id);
    setVisitedCatalogs((previous) => new Set([...previous, id]));
    setQuery("");
  };
  const openCatalog = (url: string) => {
    const existing = sources.find((source) => source.kind === "remote" && source.url === url);
    const id = existing?.id ?? crypto.randomUUID();
    setSources((previous) =>
      existing
        ? previous.map((source) => (source.id === id ? { ...source, hidden: false } : source))
        : [...previous, { id, kind: "remote", url }],
    );
    selectCatalog(id);
    setView("catalog");
  };

  const catalogByName = useMemo(
    // ponytail: matches by file name only; the first recording wins when names repeat
    () => new Map(folder.recordings.map((r) => [r.name, r])),
    [folder.recordings],
  );

  const lastOpenedByName = useMemo(
    () =>
      new Map(
        recentSources.flatMap((recent) =>
          recent.type === "file" && recent.lastOpened != undefined
            ? [[recent.title, recent.lastOpened] as const]
            : [],
        ),
      ),
    [recentSources],
  );

  // Search recents with the catalog's query language; a recent that is in the catalog matches
  // on its topics, duration and so on too.
  const filteredRecents = useMemo(() => {
    if (view !== "all" && view !== "recent") {
      return [];
    }
    const byKind = recentSources.filter((recent) => kind === "all" || recentKind(recent) === kind);
    if (query.trim() === "") {
      return byKind;
    }
    const asRecordings = byKind.map(
      (recent): CatalogRecording => ({
        ...catalogMatch(recent, catalogByName),
        id: recent.id,
        name: recent.name ?? splitRecentTitle(recent.title).primary,
        source: { type: "remote-file", url: recent.title },
      }),
    );
    const matches = new Set(filterRecordings(asRecordings, query).map((r) => r.id));
    return byKind.filter((recent) => matches.has(recent.id));
  }, [recentSources, kind, query, catalogByName, view]);

  const searching = query.trim() !== "" || kind !== "all";
  const visibleRecents =
    view === "recent" || searching
      ? filteredRecents
      : filteredRecents.slice(0, RECENTS_PREVIEW_COUNT);
  const showRecents =
    (view === "all" || view === "recent") &&
    (filteredRecents.length > 0 || (searching && recentSources.length > 0));
  const showOverview =
    view === "all" && sources.find((source) => source.id === DEFAULT_CATALOG)?.hidden !== true;

  // Enter in the search box opens the first recent listed, else the first catalog match.
  // ponytail: the catalog's first match is in folder order, not the catalog's current sort
  const topRecent = showRecents && query.trim() !== "" ? visibleRecents[0] : undefined;
  const topRecording =
    !topRecent && showOverview && query.trim() !== ""
      ? filterRecordings(folder.recordings, query)[0]
      : undefined;
  const topMatch = topRecent
    ? (topRecent.name ?? splitRecentTitle(topRecent.title).primary)
    : topRecording?.name;
  const openTopMatch = () => {
    if (topRecent) {
      selectRecent(topRecent.id);
    } else if (topRecording) {
      void folder.open(topRecording);
    }
  };

  const liveSections =
    view === "live"
      ? availableSources.flatMap(({ id, LiveDevices, disabledReason }) =>
          LiveDevices && disabledReason == undefined
            ? [<LiveDevices key={id} query={query} />]
            : [],
        )
      : [];

  return (
    <Stack className={classes.page}>
      {view === "live" ? (
        <TextField
          type="search"
          size="small"
          placeholder={t("searchLiveDevices")}
          slotProps={{ htmlInput: { "aria-label": t("searchLiveDevices") } }}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      ) : (
        <OpenUrlInput
          value={query}
          onChange={setQuery}
          topMatch={topMatch}
          onOpenTopMatch={openTopMatch}
          onOpenCatalog={openCatalog}
        />
      )}

      {/* What to show on the left; the controls for that view on the right. */}
      <div className={classes.tabRow}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          onChange={(_event, value: View | null) => {
            if (value) {
              setView(value);
            }
          }}
          aria-label={t("view")}
        >
          <ToggleButton value="all">{t("tabAll")}</ToggleButton>
          <ToggleButton value="catalog">{t("tabCatalog")}</ToggleButton>
          <ToggleButton value="recent">{t("tabRecent")}</ToggleButton>
          <ToggleButton value="recordings">{t("tabRecordings")}</ToggleButton>
          <ToggleButton value="live">{t("tabLive")}</ToggleButton>
        </ToggleButtonGroup>
        <div className={classes.spacer} />
        {view === "recent" && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={kind}
            onChange={(_event, value: Kind | null) => {
              setKind(value ?? "all");
            }}
            aria-label={t("sourceKind")}
          >
            <ToggleButton value="all">{t("kindAll")}</ToggleButton>
            <ToggleButton value="file">{t("kindFile")}</ToggleButton>
            <ToggleButton value="remote">{t("kindRemote")}</ToggleButton>
            <ToggleButton value="live">{t("kindLive")}</ToggleButton>
          </ToggleButtonGroup>
        )}
      </div>

      {view === "recent" && recentSources.length === 0 && (
        <Typography variant="body2" color="textSecondary">
          {t("noRecents")}
        </Typography>
      )}

      {showRecents && (
        <Stack gap={0.5} className={view === "recent" ? classes.recentsFull : classes.recents}>
          <Stack direction="row" alignItems="center" gap={1}>
            <Typography variant="subtitle2" style={{ flex: "auto" }}>
              {t("recentDataSources")}
            </Typography>
            {recentSources.some((recent) => recent.pinned !== true) && (
              <Button size="small" color="inherit" onClick={clearRecents}>
                {t("clearRecents")}
              </Button>
            )}
          </Stack>
          {filteredRecents.length === 0 && (
            <Typography variant="body2" color="textSecondary">
              {t("noRecentMatches")}
            </Typography>
          )}
          <List disablePadding dense className={classes.recentList}>
            {visibleRecents.map((recent) => {
              const pinned = recent.pinned === true;
              const match = catalogMatch(recent, catalogByName);
              // A recent the catalog knows reads like a catalog row: start, duration and size.
              const summary = [
                match ? recordingCaption(match) : "",
                match?.topics ? t("topicCount", { count: match.topics.length }) : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <ListItem
                  disablePadding
                  key={recent.id}
                  id={recent.id}
                  className={classes.recentListItem}
                  secondaryAction={
                    <>
                      <Tooltip title={pinned ? t("unpin") : t("pin")}>
                        <IconButton
                          size="small"
                          aria-label={pinned ? t("unpin") : t("pin")}
                          className={pinned ? undefined : "recent-action"}
                          onClick={() => {
                            togglePinRecent(recent.id);
                          }}
                        >
                          {pinned ? (
                            <PushPinIcon style={{ fontSize: 16 }} />
                          ) : (
                            <PushPinOutlinedIcon style={{ fontSize: 16 }} />
                          )}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t("removeRecent")}>
                        <IconButton
                          size="small"
                          edge="end"
                          aria-label={t("removeRecent")}
                          className="recent-action"
                          onClick={() => {
                            removeRecent(recent.id);
                          }}
                        >
                          <CloseIcon style={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </>
                  }
                >
                  <ListItemButton
                    selected={recent.current === true}
                    style={{ gap: 12 }}
                    onClick={() => {
                      selectRecent(recent.id);
                    }}
                  >
                    {match && <RecordingThumbnail recording={match} />}
                    <RecentSourceLabel recent={recent} hidePinIndicator />
                    {summary !== "" && (
                      <Typography variant="caption" noWrap color="textSecondary">
                        {summary}
                      </Typography>
                    )}
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
          {visibleRecents.length < filteredRecents.length && (
            <Button
              size="small"
              className={classes.showAllRecents}
              onClick={() => {
                setView("recent");
              }}
            >
              {t("showAllRecents", { count: filteredRecents.length })}
            </Button>
          )}
        </Stack>
      )}

      {view === "live" &&
        (liveSections.length > 0 ? (
          liveSections
        ) : (
          <Typography variant="body2" color="textSecondary">
            {t("noLiveDeviceSources")}
          </Typography>
        ))}

      {view === "recordings" && (
        <LiveRecordingsList
          query={query}
          onQueryChange={setQuery}
          lastOpenedByName={lastOpenedByName}
        />
      )}

      <Stack flex="1" style={{ minHeight: 0, display: view === "catalog" ? "flex" : "none" }}>
        <SavedCatalogs
          sources={sources}
          selected={selectedCatalog}
          select={selectCatalog}
          setSources={setSources}
          visited={visitedCatalogs}
          folder={folder}
          visible={view === "catalog"}
          query={query}
          lastOpenedByName={lastOpenedByName}
          onQueryChange={setQuery}
        />
      </Stack>
      {showOverview && (
        <Catalog
          folder={folder}
          query={query}
          lastOpenedByName={lastOpenedByName}
          onQueryChange={setQuery}
          view="list"
          sections={false}
        />
      )}

      <footer className={classes.footer}>
        <Typography variant="body2" color="textSecondary">
          {t("newToLichtblick")}
        </Typography>
        <Button
          size="small"
          onClick={() => {
            dialogActions.dataSource.open("demo");
          }}
        >
          {t("exploreSampleData")}
        </Button>
        <Button
          size="small"
          onClick={() => {
            usePanelGuideStore.getState().show();
          }}
        >
          {t("openPanelGuide")}
        </Button>
        <div className={classes.spacer} />
        <DontShowThisAgainCheckbox />
        <Typography variant="caption" color="textSecondary">
          {t("version", { version: APP_CONFIG.version })}
        </Typography>
      </footer>
    </Stack>
  );
}
