// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Dismiss16Regular, Pin16Filled, Pin16Regular } from "@fluentui/react-icons";
import {
  Button,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";
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
import { OpenUrlInput } from "@lichtblick/suite-base/components/DataSourceDialog/OpenUrlInput";
import { useStyles } from "@lichtblick/suite-base/components/DataSourceDialog/index.style";
import { RecentSourceLabel } from "@lichtblick/suite-base/components/RecentSourceLabel";
import Stack from "@lichtblick/suite-base/components/Stack";
import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";
import { LICHTBLICK_DOCUMENTATION_LINK } from "@lichtblick/suite-base/constants/documentation";
import { useAnalytics } from "@lichtblick/suite-base/context/AnalyticsContext";
import {
  RecentSource,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { AppEvent } from "@lichtblick/suite-base/services/IAnalytics";
import { splitRecentTitle } from "@lichtblick/suite-base/util/recentSources";

// Number of recents listed on the All tab, unless searching
const RECENTS_PREVIEW_COUNT = 5;

type View = "all" | "catalog" | "recent";
type Kind = "all" | "file" | "remote" | "live";
type CatalogView = "list" | "grid" | "map";

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
export default function Start(): React.JSX.Element {
  const { recentSources, selectRecent, removeRecent, togglePinRecent, clearRecents } =
    usePlayerSelection();
  const { classes } = useStyles();
  const { t } = useTranslation("openDialog");
  const { dialogActions } = useWorkspaceActions();
  const analytics = useAnalytics();
  const folder = useCatalogFolder();

  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [kindFilter, setKind] = useState<Kind>("all");
  // The kind filter belongs to the Recent tab; All shows every kind.
  const kind = view === "recent" ? kindFilter : "all";
  const [catalogView, setCatalogView] = useState<CatalogView>("list");

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
    const byKind = recentSources.filter((recent) => kind === "all" || recentKind(recent) === kind);
    if (query.trim() === "") {
      return byKind;
    }
    const asRecordings = byKind.map(
      (recent): CatalogRecording => ({
        ...catalogMatch(recent, catalogByName),
        id: recent.id,
        name: splitRecentTitle(recent.title).primary,
        source: { type: "remote-file", url: recent.title },
      }),
    );
    const matches = new Set(filterRecordings(asRecordings, query).map((r) => r.id));
    return byKind.filter((recent) => matches.has(recent.id));
  }, [recentSources, kind, query, catalogByName]);

  const searching = query.trim() !== "" || kind !== "all";
  const visibleRecents =
    view === "recent" || searching
      ? filteredRecents
      : filteredRecents.slice(0, RECENTS_PREVIEW_COUNT);
  const showRecents =
    view !== "catalog" && (filteredRecents.length > 0 || (searching && recentSources.length > 0));
  const showCatalog = view === "catalog" || (view === "all" && (kind === "all" || kind === "file"));

  // Enter in the search box opens the first recent listed, else the first catalog match.
  // ponytail: the catalog's first match is in folder order, not the catalog's current sort
  const topRecent = showRecents && query.trim() !== "" ? visibleRecents[0] : undefined;
  const topRecording =
    !topRecent && showCatalog && query.trim() !== ""
      ? filterRecordings(folder.recordings, query)[0]
      : undefined;
  const topMatch = topRecent ? splitRecentTitle(topRecent.title).primary : topRecording?.name;
  const openTopMatch = () => {
    if (topRecent) {
      selectRecent(topRecent.id);
    } else if (topRecording) {
      void folder.open(topRecording);
    }
  };

  return (
    <Stack className={classes.page}>
      <OpenUrlInput
        value={query}
        onChange={setQuery}
        topMatch={topMatch}
        onOpenTopMatch={openTopMatch}
      />

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
        </ToggleButtonGroup>
        <div className={classes.spacer} />
        {view === "catalog" && folder.name != undefined && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={catalogView}
            onChange={(_event, value: CatalogView | null) => {
              if (value) {
                setCatalogView(value);
              }
            }}
            aria-label={t("catalogView")}
          >
            <ToggleButton value="list">{t("catalogList")}</ToggleButton>
            <ToggleButton value="grid">{t("catalogGrid")}</ToggleButton>
            <ToggleButton value="map">{t("catalogMap")}</ToggleButton>
          </ToggleButtonGroup>
        )}
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
        <Typography variant="body2" color="text.secondary">
          {t("noRecents")}
        </Typography>
      )}

      {showRecents && (
        <Stack gap={0.5} className={view === "recent" ? classes.recentsFull : classes.recents}>
          <Stack direction="row" alignItems="center" gap={1}>
            <Typography variant="subtitle2" flex="auto">
              {t("recentDataSources")}
            </Typography>
            {recentSources.some((recent) => recent.pinned !== true) && (
              <Button size="small" color="inherit" onClick={clearRecents}>
                {t("clearRecents")}
              </Button>
            )}
          </Stack>
          {filteredRecents.length === 0 && (
            <Typography variant="body2" color="text.secondary">
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
                          {pinned ? <Pin16Filled /> : <Pin16Regular />}
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
                          <Dismiss16Regular />
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
                      <Typography variant="caption" color="text.secondary" noWrap>
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

      {showCatalog && (
        <Catalog
          folder={folder}
          query={query}
          lastOpenedByName={lastOpenedByName}
          onQueryChange={setQuery}
          view={view === "catalog" ? catalogView : "list"}
        />
      )}

      <footer className={classes.footer}>
        <Typography variant="body2" color="text.secondary">
          {t("newToLichtblick")}
        </Typography>
        <Button
          size="small"
          onClick={() => {
            dialogActions.dataSource.open("demo");
            analytics.logEvent(AppEvent.DIALOG_SELECT_VIEW, { type: "demo" });
          }}
        >
          {t("exploreSampleData")}
        </Button>
        <Button size="small" href={LICHTBLICK_DOCUMENTATION_LINK} target="_blank" rel="noopener">
          {t("viewDocumentation")}
        </Button>
        <div className={classes.spacer} />
        <DontShowThisAgainCheckbox />
        <Typography variant="caption" color="text.secondary">
          {t("version", { version: APP_CONFIG.version })}
        </Typography>
      </footer>
    </Stack>
  );
}
