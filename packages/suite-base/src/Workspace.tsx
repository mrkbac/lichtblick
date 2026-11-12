// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { Time } from "@foxglove/rostime";
import { t } from "i18next";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import Logger from "@lichtblick/log";
import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import { useStyles } from "@lichtblick/suite-base/Workspace.style";
import McapBundleAPI from "@lichtblick/suite-base/api/mcapBundle/McapBundleAPI";
import { AlertsList } from "@lichtblick/suite-base/components/AlertList/AlertsList";
import { AppBar } from "@lichtblick/suite-base/components/AppBar";
import { CommandPalette } from "@lichtblick/suite-base/components/CommandPalette/CommandPalette";
import { LayoutShortcutListener } from "@lichtblick/suite-base/components/CommandPalette/layoutShortcuts";
import {
  DataSourceDialog,
  DataSourceDialogItem,
} from "@lichtblick/suite-base/components/DataSourceDialog";
import { START_ADDRESS_INPUT_ID } from "@lichtblick/suite-base/components/DataSourceDialog/OpenUrlInput";
import DataSourceSidebar from "@lichtblick/suite-base/components/DataSourceSidebar/DataSourceSidebar";
import DocumentDropListener from "@lichtblick/suite-base/components/DocumentDropListener";
import { EventsList } from "@lichtblick/suite-base/components/EventsList";
import KeyListener from "@lichtblick/suite-base/components/KeyListener";
import { KeyboardShortcuts } from "@lichtblick/suite-base/components/KeyboardShortcuts/KeyboardShortcuts";
import { APP_SHORTCUTS } from "@lichtblick/suite-base/components/KeyboardShortcuts/appShortcuts";
import LayoutBrowser from "@lichtblick/suite-base/components/LayoutBrowser";
import { LayoutTemplateCommands } from "@lichtblick/suite-base/components/LayoutTemplates";
import { LiveRecordingsDialog } from "@lichtblick/suite-base/components/LiveRecordingsDialog";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { MonitorSetupProvider } from "@lichtblick/suite-base/components/MonitorSetupContext";
import PanelLayout from "@lichtblick/suite-base/components/PanelLayout";
import PanelSettings from "@lichtblick/suite-base/components/PanelSettings";
import PlaybackControls from "@lichtblick/suite-base/components/PlaybackControls";
import Sidebars from "@lichtblick/suite-base/components/Sidebars";
import { SidebarItem } from "@lichtblick/suite-base/components/Sidebars/types";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  StudioLogsSettings,
  StudioLogsSettingsSidebar,
} from "@lichtblick/suite-base/components/StudioLogsSettings";
import { SyncAdapters } from "@lichtblick/suite-base/components/SyncAdapters";
import { TopicList } from "@lichtblick/suite-base/components/TopicList";
import VariablesList from "@lichtblick/suite-base/components/VariablesList";
import { WorkspaceDialogs } from "@lichtblick/suite-base/components/WorkspaceDialogs";
import { AllowedFileExtensions } from "@lichtblick/suite-base/constants/allowedFileExtensions";
import { useCurrentUserType } from "@lichtblick/suite-base/context/CurrentUserContext";
import { EventsStore, useEvents } from "@lichtblick/suite-base/context/EventsContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import {
  LeftSidebarItemKey,
  RightSidebarItemKey,
  SidebarItemKey,
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useAppConfigurationValue } from "@lichtblick/suite-base/hooks";
import useAlertCount from "@lichtblick/suite-base/hooks/useAlertCount";
import { useDefaultWebLaunchPreference } from "@lichtblick/suite-base/hooks/useDefaultWebLaunchPreference";
import useElectronFilesToOpen from "@lichtblick/suite-base/hooks/useElectronFilesToOpen";
import { useHandleFiles } from "@lichtblick/suite-base/hooks/useHandleFiles";
import { useLayoutTransfer } from "@lichtblick/suite-base/hooks/useLayoutTransfer";
import useSeekTimeFromCLI from "@lichtblick/suite-base/hooks/useSeekTimeFromCLI";
import { useStructureItemsStoreManager } from "@lichtblick/suite-base/panels/Plot/hooks/useStructureItemsStoreManager";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";
import { PanelStateContextProvider } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import WorkspaceContextProvider from "@lichtblick/suite-base/providers/WorkspaceContextProvider";
import { Namespace, WorkspaceProps } from "@lichtblick/suite-base/types";
import { parseAppURLState } from "@lichtblick/suite-base/util/appURLState";
import useBroadcast from "@lichtblick/suite-base/util/broadcast/useBroadcast";
import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";
import { shortcutKeyHandlers } from "@lichtblick/suite-base/util/keyboardShortcuts";
import { pwaProtocolUrl } from "@lichtblick/suite-base/util/pwaProtocolUrl";

import { useWorkspaceActions } from "./context/Workspace/useWorkspaceActions";
import { severityToBadgeColor } from "./utils";

const log = Logger.getLogger(__filename);

const selectPlayerPresence = ({ playerState }: MessagePipelineContext) => playerState.presence;
const selectPlayerIsPresent = ({ playerState }: MessagePipelineContext) =>
  playerState.presence !== PlayerPresence.NOT_PRESENT;
const selectIsPlaying = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.isPlaying === true;
const selectPause = (ctx: MessagePipelineContext) => ctx.pausePlayback;
const selectPlay = (ctx: MessagePipelineContext) => ctx.startPlayback;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectPlayUntil = (ctx: MessagePipelineContext) => ctx.playUntil;
const selectPlayerId = (ctx: MessagePipelineContext) => ctx.playerState.playerId;
const selectEventsSupported = (store: EventsStore) => store.eventsSupported;
const selectSelectEvent = (store: EventsStore) => store.selectEvent;

const selectWorkspaceDataSourceDialog = (store: WorkspaceContextStore) => store.dialogs.dataSource;
const selectWorkspaceLeftSidebarItem = (store: WorkspaceContextStore) => store.sidebars.left.item;
const selectWorkspaceLeftSidebarOpen = (store: WorkspaceContextStore) => store.sidebars.left.open;
const selectWorkspaceLeftSidebarSize = (store: WorkspaceContextStore) => store.sidebars.left.size;
const selectWorkspaceRightSidebarItem = (store: WorkspaceContextStore) => store.sidebars.right.item;
const selectWorkspaceRightSidebarOpen = (store: WorkspaceContextStore) => store.sidebars.right.open;
const selectWorkspaceRightSidebarSize = (store: WorkspaceContextStore) => store.sidebars.right.size;

/** Keeps the active workspace mounted while applying file and protocol launch requests. */
function WorkspaceContent(props: WorkspaceProps): React.JSX.Element {
  const { classes } = useStyles();
  const containerRef = useRef<HTMLDivElement>(null);
  const { availableSources, selectSource } = usePlayerSelection();
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const { alertCount, highestSeverity } = useAlertCount();

  const dataSourceDialog = useWorkspaceStore(selectWorkspaceDataSourceDialog);
  const leftSidebarItem = useWorkspaceStore(selectWorkspaceLeftSidebarItem);
  const leftSidebarOpen = useWorkspaceStore(selectWorkspaceLeftSidebarOpen);
  const leftSidebarSize = useWorkspaceStore(selectWorkspaceLeftSidebarSize);
  const rightSidebarItem = useWorkspaceStore(selectWorkspaceRightSidebarItem);
  const rightSidebarOpen = useWorkspaceStore(selectWorkspaceRightSidebarOpen);
  const rightSidebarSize = useWorkspaceStore(selectWorkspaceRightSidebarSize);
  const { AppBarComponent = AppBar } = props;

  const play = useMessagePipeline(selectPlay);
  const playUntil = useMessagePipeline(selectPlayUntil);
  const pause = useMessagePipeline(selectPause);
  const seek = useMessagePipeline(selectSeek);
  const isPlaying = useMessagePipeline(selectIsPlaying);
  const getMessagePipeline = useMessagePipelineGetter();
  const getTimeInfo = useCallback(
    () => getMessagePipeline().playerState.activeData ?? {},
    [getMessagePipeline],
  );

  const layoutManager = useLayoutManager();
  const { parseAndInstallLayout } = useLayoutTransfer();

  const { enqueueSnackbar } = useSnackbar();
  const { dialogActions, sidebarActions } = useWorkspaceActions();

  const { handleFiles } = useHandleFiles({
    availableSources,
    selectSource,
    isPlaying,
    playerEvents: { play, pause },
  });

  // Store stable reference to avoid re-running effects unnecessarily
  const handleFilesRef = useRef<typeof handleFiles>(handleFiles);
  useLayoutEffect(() => {
    handleFilesRef.current = handleFiles;
  }, [handleFiles]);

  // file types we support for drag/drop
  const allowedDropExtensions = useMemo(() => {
    const extensions: string[] = [AllowedFileExtensions.FOXE, AllowedFileExtensions.JSON];
    for (const source of availableSources) {
      if (source.type === "file" && source.supportedFileTypes) {
        extensions.push(...source.supportedFileTypes);
      }
    }
    return extensions;
  }, [availableSources]);

  // Keys the panel tree below so it remounts when the player changes
  const playerId = useMessagePipeline(selectPlayerId);

  const currentUserType = useCurrentUserType();

  useDefaultWebLaunchPreference();

  useStructureItemsStoreManager();

  const [enableDebugMode = false] = useAppConfigurationValue<boolean>(AppSetting.SHOW_DEBUG_PANELS);

  const [enableStudioLogsSidebar = false] = useAppConfigurationValue<boolean>(
    AppSetting.SHOW_DEBUG_PANELS,
  );

  // When a player is activated, hide the open dialog.
  useLayoutEffect(() => {
    if (
      playerPresence === PlayerPresence.PRESENT ||
      playerPresence === PlayerPresence.INITIALIZING
    ) {
      dialogActions.dataSource.close();
    }
  }, [dialogActions.dataSource, playerPresence]);

  useEffect(() => {
    // Focus on page load to enable keyboard interaction.
    if (containerRef.current) {
      containerRef.current.focus();
    }
  }, []);

  // files the main thread told us to open
  const filesToOpen = useElectronFilesToOpen();

  useEffect(() => {
    handleFilesRef.current = handleFiles;
  }, [handleFiles]);

  useEffect(() => {
    if (filesToOpen && filesToOpen.length > 0) {
      void handleFilesRef.current(Array.from(filesToOpen));
    }
  }, [filesToOpen]);

  const [launchedURL, setLaunchedURL] = useState<URL>();
  const initialLaunchURL = useRef(props.deepLinks?.[0]);
  const layoutRequest = useRef<AbortController>(undefined);
  const bundleRequest = useRef<AbortController>(undefined);
  useEffect(() => () => layoutRequest.current?.abort(), [launchedURL]);

  // One consumer handles both file and protocol launches; focus-existing never reloads the app.
  useEffect(() => {
    if (isDesktopApp()) {
      return;
    }
    const initialProtocolURL = initialLaunchURL.current
      ? pwaProtocolUrl(initialLaunchURL.current, new URL(window.location.href))
      : undefined;
    if (initialProtocolURL) {
      window.history.replaceState(undefined, "", initialProtocolURL.href);
    }
    window.launchQueue?.setConsumer(async ({ files, targetURL }) => {
      const initialURL = initialLaunchURL.current;
      initialLaunchURL.current = undefined;
      if (files.length === 0 && targetURL != undefined && targetURL !== initialURL) {
        const url = pwaProtocolUrl(targetURL, new URL(window.location.href));
        if (url && parseAppURLState(url)) {
          window.history.replaceState(undefined, "", url.href);
          setLaunchedURL(url);
        }
      }
      // A file launch supersedes any protocol launch still waiting on its layout, bundle or seek.
      if (files.length > 0) {
        layoutRequest.current?.abort();
        bundleRequest.current?.abort();
        setUnappliedTime({});
      }
      const fileHandles = files.filter((h): h is FileSystemFileHandle => h.kind === "file");
      if (fileHandles.length === 0) {
        return;
      }
      try {
        await handleFilesRef.current(
          await Promise.all(fileHandles.map(async (h) => await h.getFile())),
          undefined,
          fileHandles,
        );
      } catch (error) {
        log.error("Failed to open launched files", error);
        enqueueSnackbar("Failed to open the launched file", { variant: "error" });
      }
    });
    return () => window.launchQueue?.setConsumer(() => {});
  }, [enqueueSnackbar]);

  const dropHandler = useCallback(
    async ({
      files,
      handles,
      namespace = "local",
    }: {
      files?: File[];
      handles?: FileSystemFileHandle[];
      namespace?: Namespace;
    }) => {
      const filesArray = handles
        ? await Promise.all(handles.map(async (h) => await h.getFile()))
        : (files ?? []);

      void handleFiles(filesArray, namespace, handles);
    },
    [handleFiles],
  );

  // Since the _component_ field of a sidebar item entry is a component and accepts no additional
  // props we need to wrap our DataSourceSidebar component to connect the open data source action to
  // open the data source dialog.
  const DataSourceSidebarItem = useMemo(() => {
    return function DataSourceSidebarItemImpl() {
      return <DataSourceSidebar disableToolbar />;
    };
  }, []);

  const PanelSettingsSidebar = useMemo(() => {
    return function PanelSettingsSidebarImpl() {
      return <PanelSettings disableToolbar />;
    };
  }, []);

  const [sidebarItems, sidebarBottomItems] = useMemo(() => {
    const topItems = new Map<SidebarItemKey, SidebarItem>([
      [
        "connection",
        {
          iconName: "DatabaseSettings",
          title: "Data source",
          component: DataSourceSidebarItem,
          badge:
            alertCount > 0
              ? { count: alertCount, color: severityToBadgeColor(highestSeverity) }
              : undefined,
        },
      ],
    ]);

    topItems.set("panel-settings", {
      iconName: "PanelSettings",
      title: "Panel settings",
      component: PanelSettings,
    });
    if (enableStudioLogsSidebar) {
      topItems.set("logs-settings", {
        iconName: "BacklogList",
        title: "Studio logs settings",
        component: StudioLogsSettingsSidebar,
      });
    }

    const bottomItems = new Map<SidebarItemKey, SidebarItem>([]);

    return [topItems, bottomItems];
  }, [DataSourceSidebarItem, alertCount, highestSeverity, enableStudioLogsSidebar]);

  const eventsSupported = useEvents(selectEventsSupported);
  const showEventsTab = currentUserType !== "unauthenticated" && eventsSupported;

  const leftSidebarItems = useMemo(() => {
    const items = new Map<LeftSidebarItemKey, SidebarItem>([
      ["panel-settings", { title: "Panel", component: PanelSettingsSidebar }],
      ["topics", { title: "Topics", component: TopicList }],
      [
        "alerts",
        {
          title: "Alerts",
          component: AlertsList,
          badge:
            alertCount > 0
              ? { count: alertCount, color: severityToBadgeColor(highestSeverity) }
              : undefined,
        },
      ],
      ["layouts", { title: "Layouts", component: LayoutBrowser }],
    ]);
    return items;
  }, [PanelSettingsSidebar, alertCount, highestSeverity]);

  const rightSidebarItems = useMemo(() => {
    const items = new Map<RightSidebarItemKey, SidebarItem>([
      [
        "variables",
        {
          title: t("workspace:variables"),
          component: VariablesList,
        },
      ],
    ]);
    if (enableDebugMode) {
      items.set("logs-settings", {
        title: t("workspace:studioLogs"),
        component: StudioLogsSettings,
      });
    }
    if (showEventsTab) {
      items.set("events", {
        title: t("workspace:events"),
        component: EventsList,
      });
    }
    return items;
  }, [enableDebugMode, showEventsTab]);

  const keyDownHandlers = useMemo(
    () =>
      shortcutKeyHandlers(APP_SHORTCUTS, {
        "app.toggleLeftSidebar": () => {
          sidebarActions.left.setOpen((oldValue) => !oldValue);
        },
        "app.toggleRightSidebar": () => {
          sidebarActions.right.setOpen((oldValue) => !oldValue);
        },
        "app.togglePanelSettings": () => {
          sidebarActions.left.selectItem(
            leftSidebarOpen && leftSidebarItem === "panel-settings" ? undefined : "panel-settings",
          );
        },
        "app.openConnection": () => {
          dialogActions.dataSource.open("start");
          // autoFocus only applies on mount, so focus the bar when the page is already open
          requestAnimationFrame(() => {
            document.getElementById(START_ADDRESS_INPUT_ID)?.focus();
          });
        },
        "app.openFile": () => {
          void dialogActions.openFile.open().catch((err: unknown) => {
            console.error(err);
          });
        },
      }),
    [
      dialogActions.dataSource,
      dialogActions.openFile,
      leftSidebarItem,
      leftSidebarOpen,
      sidebarActions.left,
      sidebarActions.right,
    ],
  );

  const deepLink = props.deepLinks?.[0];
  const targetUrlState = useMemo(() => {
    if (launchedURL) {
      return parseAppURLState(launchedURL);
    }
    if (!deepLink) {
      return undefined;
    }
    const url = new URL(deepLink);
    if (!isDesktopApp() && url.searchParams.has("protocol")) {
      const protocolURL = pwaProtocolUrl(deepLink, new URL(window.location.href));
      return protocolURL ? parseAppURLState(protocolURL) : undefined;
    }
    return parseAppURLState(url);
  }, [launchedURL, deepLink]);

  const [unappliedSourceArgs, setUnappliedSourceArgs] = useState<
    | {
        ds: string | undefined;
        dsParams: Record<string, string> | undefined;
        sourceMetadata?: Record<string, unknown>[];
        layoutUrl?: string;
      }
    | undefined
  >(
    targetUrlState && !targetUrlState.mcapBundleId
      ? {
          ds: targetUrlState.ds,
          dsParams: targetUrlState.dsParams,
          layoutUrl: targetUrlState.layoutUrl,
        }
      : undefined,
  );
  const [unappliedTime, setUnappliedTime] = useState<{ time?: Time; previousPlayerId?: string }>(
    targetUrlState ? { time: targetUrlState.time } : {},
  );

  // Replacing a player changes the pipeline getter; it must not replay the source launch.
  const appliedLaunchURL = useRef<URL>(undefined);
  useEffect(() => {
    if (!launchedURL || appliedLaunchURL.current === launchedURL) {
      return;
    }
    appliedLaunchURL.current = launchedURL;
    const state = parseAppURLState(launchedURL);
    setUnappliedSourceArgs(
      state && !state.mcapBundleId
        ? {
            ds: state.ds,
            dsParams: state.dsParams,
            layoutUrl: state.layoutUrl,
          }
        : undefined,
    );
    setUnappliedTime({
      time: state?.time,
      previousPlayerId:
        state?.ds || state?.mcapBundleId ? getMessagePipeline().playerState.playerId : undefined,
    });
  }, [launchedURL, getMessagePipeline]);

  // Resolve MCAP bundle URLs when mcapBundleId is present.
  const mcapBundleId = targetUrlState?.mcapBundleId;
  useEffect(() => {
    if (!mcapBundleId) {
      return;
    }

    const controller = new AbortController();
    bundleRequest.current = controller;
    const { signal } = controller;

    void (async () => {
      try {
        const mcaps = await McapBundleAPI.getMcapBundle(mcapBundleId, signal);
        if (signal.aborted) {
          return;
        }
        if (mcaps.length === 0) {
          enqueueSnackbar("Session contains no data sources", { variant: "error" });
          return;
        }

        const urls = mcaps.map((mcap) => mcap.url);
        setUnappliedSourceArgs({
          ds: "remote-file",
          dsParams: { url: urls.join(",") },
          sourceMetadata: mcaps.map((mcap) => mcap.metadata),
        });
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        log.error("Failed to fetch session MCAP URLs:", error);
        enqueueSnackbar("Failed to load session data sources", { variant: "error" });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [mcapBundleId, launchedURL, enqueueSnackbar]);

  const selectEvent = useEvents(selectSelectEvent);

  /** Only the current launch may install a downloaded layout or replace saved copies. */
  const fetchLayoutFromUrl = useCallback(
    async (layoutUrl: string) => {
      if (layoutUrl === "") {
        return;
      }

      // Validate URL protocol - only http/https are allowed for security
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(layoutUrl);
      } catch {
        enqueueSnackbar("Invalid layout URL", { variant: "error" });
        return;
      }

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        enqueueSnackbar("Layout URL must use http or https protocol", { variant: "error" });
        return;
      }

      // Use origin+pathname for logging/naming to avoid leaking credentials from query params
      const safeUrlLabel = `${parsedUrl.origin}${parsedUrl.pathname}`;

      layoutRequest.current?.abort();
      const controller = new AbortController();
      layoutRequest.current = controller;
      const { signal } = controller;
      try {
        const response = await fetch(layoutUrl, { signal });
        signal.throwIfAborted();
        if (!response.ok) {
          log.error(`Failed to fetch layout: ${safeUrlLabel} (status ${response.status})`);
          enqueueSnackbar(`Failed to load layout (HTTP ${response.status})`, { variant: "error" });
          return;
        }

        // Derive filename from sanitized pathname (no credentials in name)
        const rawFilename = parsedUrl.pathname.split("/").pop();
        const filename =
          rawFilename != undefined && rawFilename !== "" ? rawFilename : "layout.json";
        const dotIndex = filename.lastIndexOf(".");
        const layoutName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;

        // Find existing layouts with the same name before saving (safe deduplication)
        const existingLayouts = await layoutManager.getLayouts();
        const matchingLayouts = existingLayouts.filter((layout) => layout.name === layoutName);

        // Delegate JSON parsing, saving, and selection to parseAndInstallLayout
        const text = await response.text();
        signal.throwIfAborted();
        const file = new File([text], filename, { type: "application/json" });
        const newLayout = await parseAndInstallLayout(file, "local", signal);

        // Only delete old layouts after successful save to avoid data loss
        if (newLayout) {
          for (const layout of matchingLayouts) {
            signal.throwIfAborted();
            await layoutManager.deleteLayout({ id: layout.id });
          }
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        log.error(`Could not load layout from ${safeUrlLabel}`, error);
        enqueueSnackbar("Failed to load layout from URL", { variant: "error" });
      }
    },
    [layoutManager, parseAndInstallLayout, enqueueSnackbar],
  );

  // Load data source from URL.
  useEffect(() => {
    if (!unappliedSourceArgs) {
      return;
    }

    let shouldUpdate = false;

    // Apply any available data source args
    if (unappliedSourceArgs.ds) {
      log.debug("Initialising source from url", unappliedSourceArgs);
      selectSource(unappliedSourceArgs.ds, {
        type: "connection",
        params: unappliedSourceArgs.dsParams,
        sourceMetadata: unappliedSourceArgs.sourceMetadata,
      });
      selectEvent(unappliedSourceArgs.dsParams?.eventId);
      shouldUpdate = true;
    }
    // Apply any available layout URL
    if (unappliedSourceArgs.layoutUrl) {
      fetchLayoutFromUrl(unappliedSourceArgs.layoutUrl).catch((error: unknown) => {
        log.error("Failed to fetch layout from URL", error);
      });
      shouldUpdate = true;
    }
    if (shouldUpdate) {
      setUnappliedSourceArgs({ ds: undefined, dsParams: undefined, layoutUrl: undefined });
    }
  }, [fetchLayoutFromUrl, selectEvent, selectSource, unappliedSourceArgs, setUnappliedSourceArgs]);

  // Seek to time in URL.
  useEffect(() => {
    if (unappliedTime.time == undefined || !seek) {
      return;
    }

    // Wait until player is ready before we try to seek.
    if (
      playerPresence !== PlayerPresence.PRESENT ||
      (unappliedTime.previousPlayerId != undefined && unappliedTime.previousPlayerId === playerId)
    ) {
      return;
    }

    log.debug(`Seeking to url time:`, unappliedTime.time);
    seek(unappliedTime.time);
    setUnappliedTime({ time: undefined });
  }, [playerId, playerPresence, seek, unappliedTime]);

  useSeekTimeFromCLI();

  const appBar = useMemo(
    () => (
      <AppBarComponent
        leftInset={props.appBarLeftInset}
        onDoubleClick={props.onAppBarDoubleClick}
        showCustomWindowControls={props.showCustomWindowControls}
        isMaximized={props.isMaximized}
        initialZoomFactor={props.initialZoomFactor}
        onMinimizeWindow={props.onMinimizeWindow}
        onMaximizeWindow={props.onMaximizeWindow}
        onUnmaximizeWindow={props.onUnmaximizeWindow}
        onCloseWindow={props.onCloseWindow}
      />
    ),
    [
      AppBarComponent,
      props.appBarLeftInset,
      props.isMaximized,
      props.initialZoomFactor,
      props.onAppBarDoubleClick,
      props.onCloseWindow,
      props.onMaximizeWindow,
      props.onMinimizeWindow,
      props.onUnmaximizeWindow,
      props.showCustomWindowControls,
    ],
  );

  useBroadcast({
    play,
    pause,
    seek,
    playUntil,
  });

  return (
    <PanelStateContextProvider>
      {dataSourceDialog.open && <DataSourceDialog />}
      <DocumentDropListener onDrop={dropHandler} allowedExtensions={allowedDropExtensions} />
      <SyncAdapters />
      <KeyListener global keyDownHandlers={keyDownHandlers} />
      <LayoutShortcutListener />
      <CommandPalette />
      <LayoutTemplateCommands />
      <KeyboardShortcuts />
      <LiveRecordingsDialog />
      <div className={classes.container} ref={containerRef} tabIndex={0}>
        {appBar}
        <Sidebars
          selectedKey=""
          onSelectKey={() => {}}
          items={sidebarItems}
          leftItems={leftSidebarItems}
          bottomItems={sidebarBottomItems}
          selectedLeftKey={leftSidebarOpen ? leftSidebarItem : undefined}
          onSelectLeftKey={sidebarActions.left.selectItem}
          leftSidebarSize={leftSidebarSize}
          setLeftSidebarSize={sidebarActions.left.setSize}
          rightItems={rightSidebarItems}
          selectedRightKey={rightSidebarOpen ? rightSidebarItem : undefined}
          onSelectRightKey={sidebarActions.right.selectItem}
          rightSidebarSize={rightSidebarSize}
          setRightSidebarSize={sidebarActions.right.setSize}
        >
          {/* To ensure no stale player state remains, we unmount all panels when players change */}
          <Stack key={playerId} data-testid="workspace-panels">
            <PanelLayout />
          </Stack>
        </Sidebars>
        {play && pause && seek && (
          <div style={{ flexShrink: 0 }} data-testid="playback-controls">
            <PlaybackControls
              play={play}
              pause={pause}
              seek={seek}
              playUntil={playUntil}
              isPlaying={isPlaying}
              getTimeInfo={getTimeInfo}
            />
          </div>
        )}
      </div>
      <WorkspaceDialogs />
    </PanelStateContextProvider>
  );
}

export default function Workspace(props: WorkspaceProps): React.JSX.Element {
  const [showOpenDialogOnStartup = true] = useAppConfigurationValue<boolean>(
    AppSetting.SHOW_OPEN_DIALOG_ON_STARTUP,
  );

  const isPlayerPresent = useMessagePipeline(selectPlayerIsPresent);

  const initialItem: undefined | DataSourceDialogItem =
    isPlayerPresent || !showOpenDialogOnStartup ? undefined : "start";

  const initialState: Pick<WorkspaceContextStore, "dialogs"> = {
    dialogs: {
      dataSource: {
        activeDataSource: undefined,
        open: initialItem != undefined,
        item: initialItem,
      },
      preferences: {
        initialTab: undefined,
        open: false,
      },
    },
  };

  return (
    <WorkspaceContextProvider
      initialState={initialState}
      disablePersistenceForStorybook={props.disablePersistenceForStorybook}
    >
      <MonitorSetupProvider>
        <WorkspaceContent {...props} />
      </MonitorSetupProvider>
    </WorkspaceContextProvider>
  );
}
