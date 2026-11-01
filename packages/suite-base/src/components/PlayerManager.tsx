// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { Button } from "@mui/material";
import * as _ from "lodash-es";
import { useSnackbar } from "notistack";
import {
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLatest, useMountedState } from "react-use";

import { useWarnImmediateReRender } from "@lichtblick/hooks";
import Logger from "@lichtblick/log";
import { Immutable } from "@lichtblick/suite";
import { MessagePipelineProvider } from "@lichtblick/suite-base/components/MessagePipeline";
import { useAnalytics } from "@lichtblick/suite-base/context/AnalyticsContext";
import {
  LayoutState,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { ExtensionCatalogContext } from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import { usePerformance } from "@lichtblick/suite-base/context/PerformanceContext";
import PlayerSelectionContext, {
  DataSourceArgs,
  IDataSourceFactory,
  PlayerSelection,
  RecentSource,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import {
  UserScriptStore,
  useUserScriptState,
} from "@lichtblick/suite-base/context/UserScriptStateContext";
import { GlobalVariables } from "@lichtblick/suite-base/hooks/useGlobalVariables";
import useIndexedDbRecents, {
  RecentRecord,
} from "@lichtblick/suite-base/hooks/useIndexedDbRecents";
import AnalyticsMetricsCollector from "@lichtblick/suite-base/players/AnalyticsMetricsCollector";
import {
  TopicAliasFunctions,
  TopicAliasingPlayer,
} from "@lichtblick/suite-base/players/TopicAliasingPlayer/TopicAliasingPlayer";
import UserScriptPlayer from "@lichtblick/suite-base/players/UserScriptPlayer";
import { Player } from "@lichtblick/suite-base/players/types";
import { UserScripts } from "@lichtblick/suite-base/types/panels";
import { mergeMultipleFileNames } from "@lichtblick/suite-base/util/mergeMultipleFileName";

const log = Logger.getLogger(__filename);

// Per tab, so a reload reopens the file that tab had open
const LAST_FILE_SOURCE_KEY = "lichtblick.lastFileSource";
type LastFileSource = { sourceId: string; title: string };

type PlayerManagerProps = {
  playerSources: readonly IDataSourceFactory[];
};

const EMPTY_USER_NODES: UserScripts = Object.freeze({});
const EMPTY_GLOBAL_VARIABLES: GlobalVariables = Object.freeze({});

const userScriptsSelector = (state: LayoutState) =>
  state.selectedLayout?.data?.userNodes ?? EMPTY_USER_NODES;
const globalVariablesSelector = (state: LayoutState) =>
  state.selectedLayout?.data?.globalVariables ?? EMPTY_GLOBAL_VARIABLES;
const isLayoutLoadingSelector = (state: LayoutState) => state.selectedLayout?.loading ?? false;

const selectUserScriptActions = (store: UserScriptStore) => store.actions;

export default function PlayerManager(
  props: PropsWithChildren<PlayerManagerProps>,
): React.JSX.Element {
  const { children, playerSources } = props;

  const perfRegistry = usePerformance();

  useWarnImmediateReRender();

  const userScriptActions = useUserScriptState(selectUserScriptActions);

  const isMounted = useMountedState();

  const analytics = useAnalytics();
  const metricsCollector = useMemo(() => new AnalyticsMetricsCollector(analytics), [analytics]);

  const [basePlayer, setBasePlayer] = useState<Player | undefined>();

  const { recents, recentsLoaded, addRecent, removeRecent, togglePinRecent, clearRecents } =
    useIndexedDbRecents();
  const [currentRecentId, setCurrentRecentId] = useState<string | undefined>();

  const userScripts = useCurrentLayoutSelector(userScriptsSelector);
  const globalVariables = useCurrentLayoutSelector(globalVariablesSelector);
  const isLayoutLoading = useCurrentLayoutSelector(isLayoutLoadingSelector);

  const topicAliasPlayer = useMemo(() => {
    if (!basePlayer) {
      return undefined;
    }

    return new TopicAliasingPlayer(basePlayer);
  }, [basePlayer]);

  // Update the alias functions when they change. We do not need to re-render the player manager
  // since nothing in the local state has changed.
  const extensionCatalogContext = useContext(ExtensionCatalogContext);
  useEffect(() => {
    // Stable empty alias functions if we don't have any
    const emptyAliasFunctions: Immutable<TopicAliasFunctions> = [];

    // We only want to set alias functions on the player when the functions have changed
    let topicAliasFunctions =
      extensionCatalogContext?.getState().installedTopicAliasFunctions ?? emptyAliasFunctions;
    topicAliasPlayer?.setAliasFunctions(topicAliasFunctions);

    return extensionCatalogContext?.subscribe((state) => {
      if (topicAliasFunctions !== state.installedTopicAliasFunctions) {
        topicAliasFunctions = state.installedTopicAliasFunctions ?? emptyAliasFunctions;
        topicAliasPlayer?.setAliasFunctions(topicAliasFunctions);
      }
    });
  }, [extensionCatalogContext, topicAliasPlayer]);

  const globalVariablesRef = useLatest(globalVariables);

  const player = useMemo(() => {
    if (!topicAliasPlayer) {
      return undefined;
    }

    const userScriptPlayer = new UserScriptPlayer(
      topicAliasPlayer,
      userScriptActions,
      perfRegistry,
    );
    userScriptPlayer.setGlobalVariables(globalVariablesRef.current);

    return userScriptPlayer;
  }, [globalVariablesRef, topicAliasPlayer, userScriptActions, perfRegistry]);

  // During layout switches, selectedLayout.data is briefly undefined (loading: true)
  useLayoutEffect(() => {
    // which causes userScripts to become {}. Don't forward that transient empty state
    // to the player — it would tear down registrations and kill active batch iterators.
    if (isLayoutLoading) {
      return;
    }

    player?.setUserScripts(userScripts).catch((error: unknown) => {
      log.error(error);
    });
  }, [player, userScripts, isLayoutLoading]);

  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  const [selectedSource, setSelectedSource] = useState<IDataSourceFactory | undefined>();

  const selectSource = useCallback(
    async (sourceId: string, args?: DataSourceArgs) => {
      log.debug(`Select Source: ${sourceId}`);

      const foundSource = playerSources.find(
        (source) => (source.id === sourceId || source.legacyIds?.includes(sourceId)) ?? false,
      );
      if (!foundSource) {
        enqueueSnackbar(`Unknown data source: ${sourceId}`, {
          variant: "warning",
        });
        return;
      }

      metricsCollector.setProperty("player", sourceId);
      setCurrentRecentId(undefined);
      // Set again below once a file source opens from handles
      sessionStorage.removeItem(LAST_FILE_SOURCE_KEY);

      setSelectedSource(foundSource);

      // Sample sources don't need args or prompts to initialize
      if (foundSource.type === "sample") {
        const newPlayer = foundSource.initialize({
          metricsCollector,
        });

        setBasePlayer(newPlayer);
        return;
      }

      if (!args) {
        enqueueSnackbar("Unable to initialize player: no args", {
          variant: "error",
        });
        setSelectedSource(undefined);
        return;
      }

      try {
        switch (args.type) {
          case "connection": {
            const newPlayer = foundSource.initialize({
              metricsCollector,
              params: args.params,
              sourceMetadata: args.sourceMetadata,
            });
            setBasePlayer(newPlayer);

            if (args.params?.url) {
              const recentId = addRecent({
                type: "connection",
                sourceId: foundSource.id,
                title: args.params.url,
                label: foundSource.displayName,
                extra: args.params,
              });
              setCurrentRecentId(recentId);
            }

            return;
          }
          case "file": {
            const handles = args.handles;
            let files = args.files;

            // Handles are stored in recents (IndexedDB) so the file can be reopened later.
            // File instances are not: storing a File in IndexedDB copies the entire file.
            if (handles) {
              for (const handle of handles) {
                const permission = await handle.queryPermission({
                  mode: "read",
                });
                if (!isMounted()) {
                  return;
                }

                if (permission !== "granted") {
                  const newPerm = await handle.requestPermission({
                    mode: "read",
                  });
                  if (newPerm !== "granted") {
                    throw new Error(`Permission denied: ${handle.name}`);
                  }
                }
              }
              files = await Promise.all(handles.map(async (f) => await f.getFile()));
              if (!isMounted()) {
                return;
              }
            }

            if (files) {
              const multiFile = foundSource.supportsMultiFile === true && files.length > 1;

              const newPlayer = foundSource.initialize({
                file: multiFile ? undefined : files[0],
                files: multiFile ? files : undefined,
                metricsCollector,
              });

              setBasePlayer(newPlayer);

              if (handles) {
                const lastFile: LastFileSource = {
                  sourceId: foundSource.id,
                  title: mergeMultipleFileNames(handles.map((h) => h.name)),
                };
                setCurrentRecentId(addRecent({ type: "file", ...lastFile, handles }));
                sessionStorage.setItem(LAST_FILE_SOURCE_KEY, JSON.stringify(lastFile) ?? "");
              }
              return;
            }
          }
        }

        enqueueSnackbar("Unable to initialize player", { variant: "error" });
      } catch (error) {
        enqueueSnackbar((error as Error).message, { variant: "error" });
      }
    },
    [playerSources, metricsCollector, enqueueSnackbar, isMounted, addRecent],
  );

  // Select a recent entry by id
  // necessary to pull out callback creation to avoid capturing the initial player in closure context
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selectRecent = useCallback(
    createSelectRecentCallback(recents, selectSource, enqueueSnackbar),
    [recents, enqueueSnackbar, selectSource],
  );

  // After a reload, reopen the file this tab had open. The URL takes precedence (ds=...).
  const restoredLastFile = useRef(false);
  useEffect(() => {
    if (!recentsLoaded || restoredLastFile.current) {
      return;
    }
    restoredLastFile.current = true;

    const stored = sessionStorage.getItem(LAST_FILE_SOURCE_KEY);
    if (!stored || new URL(window.location.href).searchParams.has("ds")) {
      return;
    }
    const lastFile = JSON.parse(stored) as LastFileSource;
    const recent = recents.find(
      (r) => r.type === "file" && r.sourceId === lastFile.sourceId && r.title === lastFile.title,
    );
    if (recent?.type !== "file") {
      return;
    }

    void (async () => {
      const permissions = await Promise.all(
        recent.handles.map(async (h) => await h.queryPermission({ mode: "read" })),
      );
      if (permissions.every((p) => p === "granted")) {
        void selectSource(recent.sourceId, { type: "file", handles: recent.handles });
        return;
      }
      // requestPermission needs a user gesture, so ask with a click
      enqueueSnackbar(`Reopen ${recent.title}?`, {
        variant: "info",
        persist: true,
        action: (key) => (
          <Button
            color="inherit"
            onClick={() => {
              closeSnackbar(key);
              void selectSource(recent.sourceId, { type: "file", handles: recent.handles });
            }}
          >
            Reopen
          </Button>
        ),
      });
    })();
  }, [recentsLoaded, recents, selectSource, enqueueSnackbar, closeSnackbar]);

  // Make a RecentSources array for the PlayerSelectionContext
  const recentSources = useMemo(() => {
    const sources = recents.map(
      (item): RecentSource => ({
        id: item.id,
        title: item.title,
        label: item.label,
        sourceId: item.sourceId,
        type: item.type,
        lastOpened: item.lastOpened,
        pinned: item.pinned,
        current: item.id === currentRecentId,
      }),
    );
    // Stable sort: pinned first, otherwise keep most-recent-first order
    return _.sortBy(sources, (source) => (source.pinned === true ? 0 : 1));
  }, [recents, currentRecentId]);

  const value: PlayerSelection = {
    selectSource,
    selectRecent,
    removeRecent,
    togglePinRecent,
    clearRecents,
    selectedSource,
    availableSources: playerSources,
    recentSources,
  };

  return (
    <>
      <PlayerSelectionContext.Provider value={value}>
        <MessagePipelineProvider player={player}>{children}</MessagePipelineProvider>
      </PlayerSelectionContext.Provider>
    </>
  );
}

/**
 * This was moved out of the PlayerManager function due to a memory leak occurring in memoized state of Start.tsx
 * that was retaining old player instances. Having this callback be defined within the PlayerManager makes it store the
 * player at instantiation within the closure context. That callback is then stored in the memoized state with its closure context.
 * The callback is updated when the player changes but part of the `Start.tsx` holds onto the formerly memoized state for an
 * unknown reason.
 * To make this function safe from storing old closure contexts in old memoized state in components where it
 * is used, it has been moved out of the PlayerManager function.
 */
function createSelectRecentCallback(
  recents: RecentRecord[],
  selectSource: (sourceId: string, dataSourceArgs: DataSourceArgs) => Promise<void>,
  enqueueSnackbar: ReturnType<typeof useSnackbar>["enqueueSnackbar"],
) {
  return (recentId: string) => {
    // find the recent from the list and initialize
    const foundRecent = recents.find((value) => value.id === recentId);
    if (!foundRecent) {
      enqueueSnackbar(`Failed to restore recent: ${recentId}`, {
        variant: "error",
      });
      return;
    }

    switch (foundRecent.type) {
      case "connection": {
        void selectSource(foundRecent.sourceId, {
          type: "connection",
          params: foundRecent.extra,
        });
        break;
      }
      case "file": {
        void selectSource(foundRecent.sourceId, {
          type: "file",
          handles: foundRecent.handles,
        });
      }
    }
  };
}
