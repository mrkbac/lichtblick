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
  useSyncExternalStore,
} from "react";

import { promiseTimeout } from "@lichtblick/den/async";
import { useLatest, useMountedState } from "@lichtblick/hooks";
import Logger from "@lichtblick/log";
import { Immutable } from "@lichtblick/suite";
import {
  HANDLE_TIMEOUT_MS,
  relinkFileHandle,
} from "@lichtblick/suite-base/components/Catalog/indexFolder";
import { CompareProvider } from "@lichtblick/suite-base/components/Compare/CompareContext";
import { MessagePipelineProvider } from "@lichtblick/suite-base/components/MessagePipeline";
import {
  LayoutID,
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import {
  ExtensionCatalog,
  ExtensionCatalogContext,
} from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import PlayerSelectionContext, {
  DataSourceArgs,
  DataSourceFactoryInitializeArgs,
  IDataSourceFactory,
  PlayerSelection,
  RecentSource,
  RemoteFileSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import {
  UserScriptStore,
  useUserScriptState,
} from "@lichtblick/suite-base/context/UserScriptStateContext";
import { createWasmDataLoaderSource } from "@lichtblick/suite-base/dataSources/WasmDataLoaderDataSourceFactory";
import { GlobalVariables } from "@lichtblick/suite-base/hooks/useGlobalVariables";
import useIndexedDbRecents, {
  RecentRecord,
} from "@lichtblick/suite-base/hooks/useIndexedDbRecents";
import {
  TopicAliasFunctions,
  TopicAliasingPlayer,
} from "@lichtblick/suite-base/players/TopicAliasingPlayer/TopicAliasingPlayer";
import UserScriptPlayer from "@lichtblick/suite-base/players/UserScriptPlayer";
import { Player } from "@lichtblick/suite-base/players/types";
import { UserScripts } from "@lichtblick/suite-base/types/panels";
import { updateAppURLState } from "@lichtblick/suite-base/util/appURLState";
import {
  Recording,
  recordingName,
  rememberHandle,
  remoteCompareNames,
} from "@lichtblick/suite-base/util/compareSides";
import {
  connectionRecentArgs,
  recentArgs,
  recentFileTitle,
  urlsOf,
} from "@lichtblick/suite-base/util/recentSources";
import { takeSourcePick } from "@lichtblick/suite-base/util/sourcePick";
import { toError } from "@lichtblick/suite-base/util/toError";

import { useTrustedUserScripts } from "./useTrustedUserScripts";

const log = Logger.getLogger(__filename);

// Per tab, so a reload reopens the file that tab had open
const LAST_FILE_SOURCE_KEY = "lichtblick.lastFileSource";
// `recentId` is the recent entry it was opened as; entries stored before it existed match by title
type LastFileSource = { sourceId: string; title: string; recentId?: string };

// Reopening on reload is a convenience: blocked storage or a bad value must not break the app
/** Starts loading a source's player code without waiting; a failure surfaces when it opens */
function prefetch(source: IDataSourceFactory): void {
  source.prefetch?.().catch(() => {});
}

function readLastFile(): LastFileSource | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(LAST_FILE_SOURCE_KEY) ?? "null") as unknown;
    if (
      typeof value === "object" &&
      value != undefined &&
      "sourceId" in value &&
      typeof value.sourceId === "string" &&
      "title" in value &&
      typeof value.title === "string"
    ) {
      const recentId =
        "recentId" in value && typeof value.recentId === "string" ? value.recentId : undefined;
      return { sourceId: value.sourceId, title: value.title, recentId };
    }
  } catch (err: unknown) {
    log.warn("Unable to read last file source", err);
  }
  return undefined;
}

function writeLastFile(lastFile: LastFileSource | undefined): void {
  try {
    if (lastFile) {
      sessionStorage.setItem(LAST_FILE_SOURCE_KEY, JSON.stringify(lastFile) ?? "");
    } else {
      sessionStorage.removeItem(LAST_FILE_SOURCE_KEY);
    }
  } catch (err: unknown) {
    log.warn("Unable to store last file source", err);
  }
}

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
const layoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;
const layoutEditedSelector = (state: LayoutState) => state.selectedLayout?.edited ?? false;

const selectUserScriptActions = (store: UserScriptStore) => store.actions;
const NO_DATA_LOADERS: ExtensionCatalog["installedDataLoaders"] = [];
const noSubscription = () => () => {};

export default function PlayerManager(
  props: PropsWithChildren<PlayerManagerProps>,
): React.JSX.Element {
  const { children } = props;

  // Data loaders that extensions registered come after the built-in sources, which keep their
  // file types
  const extensionCatalogContext = useContext(ExtensionCatalogContext);
  const dataLoaders = useSyncExternalStore(
    extensionCatalogContext?.subscribe ?? noSubscription,
    () => extensionCatalogContext?.getState().installedDataLoaders ?? NO_DATA_LOADERS,
  );
  const playerSources = useMemo(
    (): readonly IDataSourceFactory[] => [
      ...props.playerSources,
      ...dataLoaders.map(createWasmDataLoaderSource),
    ],
    [props.playerSources, dataLoaders],
  );

  const userScriptActions = useUserScriptState(selectUserScriptActions);

  const isMounted = useMountedState();

  const [basePlayer, setBasePlayer] = useState<Player | undefined>();

  const { recents, recentsLoaded, addRecent, removeRecent, togglePinRecent, clearRecents } =
    useIndexedDbRecents();
  const [currentRecentId, setCurrentRecentId] = useState<string | undefined>();

  const layoutUserScripts = useCurrentLayoutSelector(userScriptsSelector);
  const { scripts: userScripts, prompt: userScriptsPrompt } = useTrustedUserScripts({
    layoutId: useCurrentLayoutSelector(layoutIdSelector),
    userScripts: layoutUserScripts,
    edited: useCurrentLayoutSelector(layoutEditedSelector),
  });

  const globalVariables = useCurrentLayoutSelector(globalVariablesSelector);
  const isLayoutLoading = useCurrentLayoutSelector(isLayoutLoadingSelector);
  const layoutManager = useLayoutManager();
  const { setSelectedLayoutId } = useCurrentLayoutActions();

  const topicAliasPlayer = useMemo(() => {
    if (!basePlayer) {
      return undefined;
    }

    return new TopicAliasingPlayer(basePlayer);
  }, [basePlayer]);

  // Update the alias functions when they change. We do not need to re-render the player manager
  // since nothing in the local state has changed.
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

    const userScriptPlayer = new UserScriptPlayer(topicAliasPlayer, userScriptActions);
    userScriptPlayer.setGlobalVariables(globalVariablesRef.current);

    return userScriptPlayer;
  }, [globalVariablesRef, topicAliasPlayer, userScriptActions]);

  // Foxglove topic converters from extensions run in the user script player.
  useEffect(() => {
    if (!player) {
      return;
    }
    const setTopicConverters = (converters: ExtensionCatalog["installedTopicConverters"]) => {
      player.setTopicConverters(converters).catch((error: unknown) => {
        log.error(error);
      });
    };
    let topicConverters = extensionCatalogContext?.getState().installedTopicConverters ?? [];
    if (topicConverters.length > 0) {
      setTopicConverters(topicConverters);
    }
    return extensionCatalogContext?.subscribe((state) => {
      if (topicConverters !== state.installedTopicConverters) {
        topicConverters = state.installedTopicConverters;
        setTopicConverters(topicConverters);
      }
    });
  }, [extensionCatalogContext, player]);

  // During layout switches (loading: true) the data still belongs to the previous layout.
  useLayoutEffect(() => {
    // Don't forward its scripts to the player only to replace them once the new layout
    // loads — it would tear down registrations and kill active batch iterators.
    if (isLayoutLoading) {
      return;
    }

    player?.setUserScripts(userScripts).catch((error: unknown) => {
      log.error(error);
    });
  }, [player, userScripts, isLayoutLoading]);

  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  const [selectedSource, setSelectedSource] = useState<IDataSourceFactory | undefined>();
  const [selectedRecordings, setSelectedRecordings] = useState<readonly Recording[] | undefined>();
  const [selectedRemoteFile, setSelectedRemoteFile] = useState<RemoteFileSelection | undefined>();
  const [selectedCompare, setSelectedCompare] = useState<readonly string[] | undefined>();
  const [selectedWithCookies, setSelectedWithCookies] = useState(false);

  // Sample layout ids for this session, used when localStorage is unavailable.
  const sampleLayoutIds = useRef(new Map<string, { id: LayoutID; version: string }>());
  // Bumped on every selectSource/closeSource call, so a slow earlier selection can tell it was
  // superseded and won't apply its player or layout late.
  const selectionSeq = useRef(0);
  const pendingTransport = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => pendingTransport.current?.abort(), []);

  // Player code loads on demand (see dataSources/playerModules). Once the app is idle after
  // starting, load it for the file and sample sources, so opening one rarely waits for a chunk.
  // Connection sources load theirs when picked.
  useEffect(() => {
    const prefetchAll = () => {
      for (const source of playerSources) {
        if (source.type !== "connection") {
          prefetch(source);
        }
      }
    };
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(prefetchAll, { timeout: 5000 });
      return () => {
        cancelIdleCallback(handle);
      };
    }
    const timer = setTimeout(prefetchAll, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [playerSources]);

  const openSource = useCallback(
    async (sourceId: string, args?: DataSourceArgs) => {
      log.debug(`Select Source: ${sourceId}`);
      const seq = ++selectionSeq.current;
      pendingTransport.current?.abort();

      const foundSource = playerSources.find(
        (source) => (source.id === sourceId || source.legacyIds?.includes(sourceId)) ?? false,
      );
      if (!foundSource) {
        enqueueSnackbar(`Unknown data source: ${sourceId}`, {
          variant: "warning",
        });
        return;
      }

      // Start loading the player's code while the rest of the selection (permission prompts,
      // reading file handles) runs
      prefetch(foundSource);

      // Factories may load their player's code first. Resolves undefined when a newer selection
      // or a close superseded this one meanwhile; a player built for it anyway is closed again.
      const initializePlayer = async (
        initArgs: DataSourceFactoryInitializeArgs,
      ): Promise<{ player: Player | undefined } | undefined> => {
        const newPlayer = await foundSource.initialize(initArgs);
        if (initArgs.transport && !newPlayer) {
          throw new Error("Unable to initialize player");
        }
        if (!isMounted() || seq !== selectionSeq.current) {
          newPlayer?.close();
          return undefined;
        }
        return { player: newPlayer };
      };
      let transport: DataSourceFactoryInitializeArgs["transport"];
      if (args?.type === "connection" && foundSource.prepareTransport) {
        const controller = new AbortController();
        pendingTransport.current = controller;
        try {
          transport = await foundSource.prepareTransport(controller.signal);
          if (controller.signal.aborted) {
            transport.dispose?.();
            return;
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            enqueueSnackbar(toError(error).message, { variant: "error" });
          }
          return;
        } finally {
          if (pendingTransport.current === controller) {
            pendingTransport.current = undefined;
          }
        }
      }
      // Only once the new player exists: a failed initialize keeps the current player running,
      // and it still needs its selection (Compare, Export).
      const commitSelection = (
        recordings?: readonly Recording[],
        compare?: readonly string[],
        {
          withCookies = false,
          remoteFile,
        }: { withCookies?: boolean; remoteFile?: RemoteFileSelection } = {},
      ) => {
        setCurrentRecentId(undefined);
        setSelectedSource(foundSource);
        setSelectedRecordings(recordings);
        setSelectedRemoteFile(remoteFile);
        setSelectedCompare(compare);
        setSelectedWithCookies(withCookies);
      };

      // Sample sources don't need args or prompts to initialize
      if (foundSource.type === "sample") {
        let initialized;
        try {
          initialized = await initializePlayer({});
        } catch (error) {
          if (seq === selectionSeq.current) {
            enqueueSnackbar(toError(error).message, { variant: "error" });
          }
          return;
        }
        if (!initialized) {
          return;
        }
        commitSelection();

        setBasePlayer(initialized.player);
        writeLastFile(undefined);

        // Show the sample in the layout made for it. Its id is remembered per source, so an
        // edited or renamed copy is reopened and same-named layouts are never picked up.
        const keepLayout = args?.type === "connection" && args.keepLayout === true;
        if (foundSource.sampleLayout && !keepLayout) {
          const storageKey = `lichtblick.sampleLayoutId.${foundSource.id}`;
          const versionKey = `${storageKey}.version`;
          const version = String(foundSource.sampleLayoutVersion ?? 1);
          // This session's copy wins, so a failed localStorage write can't make it look outdated.
          const sessionCopy = sampleLayoutIds.current.get(storageKey);
          let savedId = sessionCopy?.id;
          let savedVersion = sessionCopy?.version;
          if (sessionCopy == undefined) {
            try {
              savedId = (localStorage.getItem(storageKey) as LayoutID | null) ?? undefined;
              // Copies saved before versions were tracked are version 1.
              savedVersion = localStorage.getItem(versionKey) ?? "1";
            } catch (error) {
              log.warn("Could not read the saved sample layout id", error);
            }
          }
          try {
            let existing = savedId ? await layoutManager.getLayout(savedId) : undefined;
            if (existing && savedVersion !== version) {
              // The sample layout changed: keep the old copy, with any edits, under another name.
              await layoutManager.updateLayout({
                id: existing.id,
                name: `${existing.name} (previous version)`,
              });
              existing = undefined;
            }
            const layout =
              existing ??
              (await layoutManager.saveNewLayout({
                name: foundSource.displayName,
                data: foundSource.sampleLayout,
                permission: "CREATOR_WRITE",
              }));
            sampleLayoutIds.current.set(storageKey, { id: layout.id, version });
            try {
              localStorage.setItem(storageKey, layout.id);
              localStorage.setItem(versionKey, version);
            } catch (error) {
              log.warn("Could not save the sample layout id; it is kept for this session", error);
            }
            if (isMounted() && seq === selectionSeq.current) {
              setSelectedLayoutId(layout.id);
            }
          } catch (error) {
            log.error(error);
            enqueueSnackbar(`Could not open the sample layout: ${String(error)}`, {
              variant: "error",
            });
          }
        }
        return;
      }

      if (!args) {
        enqueueSnackbar("Unable to initialize player: no args", {
          variant: "error",
        });
        return;
      }

      try {
        switch (args.type) {
          case "connection": {
            const initialized = await initializePlayer({
              params: args.params,
              ...(args.urls != undefined && { urls: args.urls }),
              transport,
            });
            transport = undefined; // The initialized player owns its backend.
            if (!initialized) {
              return;
            }
            // Remote recordings (not live connections) can be compared like local files
            const urls = urlsOf(args);
            const withCookies = args.params?.includeCredentials === "true";
            // One remote file can also be exported
            const remoteFile: RemoteFileSelection | undefined =
              foundSource.id === "remote-file" && urls.length === 1
                ? { url: urls[0]!, credentials: withCookies ? "include" : undefined }
                : undefined;
            const isRecording = urls.length > 0 && foundSource.supportedFileTypes != undefined;
            const compare = isRecording ? remoteCompareNames(urls, args.params) : undefined;
            if (isRecording) {
              commitSelection(urls, compare, {
                withCookies,
                remoteFile,
              });
            } else {
              commitSelection(undefined, undefined, { remoteFile });
            }
            setBasePlayer(initialized.player);
            writeLastFile(undefined);

            if (urls.length > 0) {
              const recentId = addRecent({
                type: "connection",
                sourceId: foundSource.id,
                title:
                  urls.length === 1 ? urls[0]! : recentFileTitle(urls.map(recordingName), compare),
                label: foundSource.displayName,
                extra: isRecording ? _.omit(args.params, "url") : args.params,
                ...(isRecording && { urls }),
              });
              setCurrentRecentId(recentId);
            }

            return;
          }
          case "file": {
            let handles = args.handles;
            let files = args.files;

            // Handles are stored in recents (IndexedDB) so the file can be reopened later.
            // File instances are not: storing a File in IndexedDB copies the entire file.
            if (handles) {
              // A file compared in several sides repeats its handle: ask and read it once
              // URLs (in a comparison that mixes them with files) need no permission
              const stored = [
                ...new Set(handles.filter((h): h is FileSystemFileHandle => typeof h !== "string")),
              ];
              const relinked = new Map(
                await Promise.all(stored.map(async (h) => [h, await relinkFileHandle(h)] as const)),
              );
              if (!isMounted() || seq !== selectionSeq.current) {
                return;
              }
              // The recent saved below keeps the relinked handles
              handles = handles.map((h) => (typeof h === "string" ? h : relinked.get(h)!));
              const uniqueHandles = [...new Set(relinked.values())];
              for (const handle of uniqueHandles) {
                const permission = await handle.queryPermission({
                  mode: "read",
                });
                if (!isMounted() || seq !== selectionSeq.current) {
                  return;
                }

                if (permission !== "granted") {
                  const newPerm = await handle.requestPermission({
                    mode: "read",
                  });
                  if (!isMounted() || seq !== selectionSeq.current) {
                    return;
                  }
                  if (newPerm !== "granted") {
                    throw new Error(`Permission denied: ${handle.name}`);
                  }
                }
              }
              const fileOf = new Map(
                await Promise.all(uniqueHandles.map(async (h) => [h, await h.getFile()] as const)),
              );
              if (!isMounted() || seq !== selectionSeq.current) {
                return;
              }
              files = handles.map((h) => (typeof h === "string" ? h : fileOf.get(h)!));
              for (const [handle, file] of fileOf) {
                rememberHandle(file, handle);
              }
            }

            if (files) {
              const multiFile = foundSource.supportsMultiFile === true && files.length > 1;
              const localFiles = files.filter((f): f is File => typeof f !== "string");
              // Remote URLs among the files: only a source that compares can read them
              const mixed = localFiles.length !== files.length;
              if (mixed && foundSource.supportsCompare !== true) {
                throw new Error(`${foundSource.displayName} can't open remote recordings`);
              }

              const compare =
                multiFile && foundSource.supportsCompare === true ? args.compare : undefined;
              const initialized = await initializePlayer(
                mixed
                  ? { recordings: files, compare }
                  : {
                      file: multiFile ? undefined : localFiles[0],
                      handle: multiFile
                        ? undefined
                        : (handles?.[0] as FileSystemFileHandle | undefined),
                      files: multiFile ? localFiles : undefined,
                      compare,
                    },
              );
              if (!initialized) {
                return;
              }
              commitSelection(files, compare);

              setBasePlayer(initialized.player);

              // Only handles can be reopened after a reload
              if (handles) {
                const title = recentFileTitle(
                  handles.map((h) => (typeof h === "string" ? recordingName(h) : h.name)),
                  compare,
                );
                const recentId = addRecent({
                  type: "file",
                  sourceId: foundSource.id,
                  title,
                  handles,
                  compare: compare ? [...compare] : undefined,
                });
                setCurrentRecentId(recentId);
                writeLastFile({ sourceId: foundSource.id, title, recentId });
              } else {
                writeLastFile(undefined);
              }
              return;
            }
          }
        }

        enqueueSnackbar("Unable to initialize player", { variant: "error" });
      } catch (error) {
        transport?.dispose?.();
        // A superseded selection (closed or replaced meanwhile) shouldn't surface its error
        if (seq === selectionSeq.current) {
          enqueueSnackbar(toError(error).message, { variant: "error" });
        }
      }
    },
    [playerSources, enqueueSnackbar, isMounted, addRecent, layoutManager, setSelectedLayoutId],
  );

  // Opening from what the user did (a menu, the open page, a recent, a link): a source picked for
  // something else (e.g. a comparison row) goes there instead, leaving the open source as it is.
  // Opening on its own (restoring the last file) uses openSource and never satisfies a pick.
  const selectSource = useCallback(
    async (sourceId: string, args?: DataSourceArgs) => {
      if (!takeSourcePick(sourceId, args)) {
        await openSource(sourceId, args);
      }
    },
    [openSource],
  );

  // Select a recent entry by id
  // necessary to pull out callback creation to avoid capturing the initial player in closure context
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selectRecent = useCallback(
    createSelectRecentCallback(recents, selectSource, enqueueSnackbar),
    [recents, enqueueSnackbar, selectSource],
  );

  // After a reload, reopen the file this tab had open. The URL takes precedence (ds=...).
  // Reads the latest openSource: a data loader's source shows up once extensions have loaded.
  const openSourceRef = useLatest(openSource);
  const restoredLastFile = useRef(false);
  useEffect(() => {
    if (!recentsLoaded || restoredLastFile.current) {
      return;
    }
    restoredLastFile.current = true;

    // Only restore into an untouched session: the user may have picked or closed a source
    // before recents finished loading.
    if (selectionSeq.current !== 0) {
      return;
    }
    const lastFile = readLastFile();
    // A link that opens a source or a catalog asked for that instead.
    const params = new URL(window.location.href).searchParams;
    if (!lastFile || params.has("ds") || params.has("catalog")) {
      return;
    }
    // By title when the id is gone: another tab re-opened the same file and stored its own id
    const recent =
      recents.find((r) => lastFile.recentId != undefined && r.id === lastFile.recentId) ??
      recents.find(
        (r) => r.type === "file" && r.sourceId === lastFile.sourceId && r.title === lastFile.title,
      );
    if (recent?.type !== "file") {
      return;
    }

    const seq = selectionSeq.current;
    void (async () => {
      const permissions = await Promise.all(
        recent.handles.map(async (h) =>
          typeof h === "string"
            ? "granted"
            : // A dead handle can hang: ask with a click, which relinks or says why it can't
              await promiseTimeout(h.queryPermission({ mode: "read" }), HANDLE_TIMEOUT_MS).catch(
                () => "prompt",
              ),
        ),
      );
      // The user opened or closed a source meanwhile: don't override that with the restore
      if (seq !== selectionSeq.current) {
        return;
      }
      if (permissions.every((p) => p === "granted")) {
        void openSourceRef.current(recent.sourceId, recentArgs(recent));
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
              void openSourceRef.current(recent.sourceId, recentArgs(recent));
            }}
          >
            Reopen
          </Button>
        ),
      });
    })();
  }, [recentsLoaded, recents, openSourceRef, enqueueSnackbar, closeSnackbar]);

  const closeSource = useCallback(() => {
    selectionSeq.current++;
    pendingTransport.current?.abort();
    // Dropping the player makes MessagePipelineProvider close() it (e.g. closes the websocket).
    setBasePlayer(undefined);
    setSelectedSource(undefined);
    setSelectedRecordings(undefined);
    setSelectedRemoteFile(undefined);
    setSelectedCompare(undefined);
    setSelectedWithCookies(false);
    setCurrentRecentId(undefined);
    // Forget the last opened file so a reload doesn't reopen it (the recent entry stays).
    writeLastFile(undefined);
    // Drop ds/time/mcap-bundle from the URL so a reload doesn't reconnect.
    const url = updateAppURLState(new URL(window.location.href), {
      ds: undefined,
      dsParams: {},
      time: undefined,
    });
    url.searchParams.delete("mcap-bundle");
    window.history.replaceState(undefined, "", url.href);
  }, []);

  // Make a RecentSources array for the PlayerSelectionContext
  const recentSources = useMemo(() => {
    const sources = recents.map(
      (item): RecentSource => ({
        id: item.id,
        title: item.title,
        name: item.type === "connection" ? item.extra?.name : undefined,
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

  const value = useMemo(
    (): PlayerSelection => ({
      selectSource,
      closeSource,
      selectRecent,
      removeRecent,
      togglePinRecent,
      clearRecents,
      selectedSource,
      selectedRecordings,
      selectedRemoteFile,
      selectedCompare,
      selectedWithCookies,
      availableSources: playerSources,
      recentSources,
    }),
    [
      selectSource,
      closeSource,
      selectRecent,
      removeRecent,
      togglePinRecent,
      clearRecents,
      selectedSource,
      selectedRecordings,
      selectedRemoteFile,
      selectedCompare,
      selectedWithCookies,
      playerSources,
      recentSources,
    ],
  );

  return (
    <>
      {userScriptsPrompt}
      <PlayerSelectionContext.Provider value={value}>
        <MessagePipelineProvider player={player}>
          <CompareProvider>{children}</CompareProvider>
        </MessagePipelineProvider>
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
        void selectSource(foundRecent.sourceId, connectionRecentArgs(foundRecent));
        break;
      }
      case "file": {
        void selectSource(foundRecent.sourceId, recentArgs(foundRecent));
      }
    }
  };
}
