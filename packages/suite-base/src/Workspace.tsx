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
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { pushAll } from "@lichtblick/den/collection";
import Logger from "@lichtblick/log";
import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import { useStyles } from "@lichtblick/suite-base/Workspace.style";
import { AlertsList } from "@lichtblick/suite-base/components/AlertList/AlertsList";
import { AppBar } from "@lichtblick/suite-base/components/AppBar";
import { AttachmentList } from "@lichtblick/suite-base/components/Attachments/AttachmentList";
import { useToggleColorScheme } from "@lichtblick/suite-base/components/ColorSchemeThemeProvider";
import { CommandPalette } from "@lichtblick/suite-base/components/CommandPalette/CommandPalette";
import { LayoutShortcutListener } from "@lichtblick/suite-base/components/CommandPalette/layoutShortcuts";
import { useCompareDialog } from "@lichtblick/suite-base/components/Compare/compareDialogStore";
import {
  DataSourceDialog,
  DataSourceDialogItem,
} from "@lichtblick/suite-base/components/DataSourceDialog/DataSourceDialog";
import { START_ADDRESS_INPUT_ID } from "@lichtblick/suite-base/components/DataSourceDialog/OpenUrlInput";
import DataSourceSidebar from "@lichtblick/suite-base/components/DataSourceSidebar/DataSourceSidebar";
import DocumentDropListener from "@lichtblick/suite-base/components/DocumentDropListener";
import { EventsList } from "@lichtblick/suite-base/components/EventsList";
import KeyListener from "@lichtblick/suite-base/components/KeyListener";
import { KeyboardShortcuts } from "@lichtblick/suite-base/components/KeyboardShortcuts/KeyboardShortcuts";
import { APP_SHORTCUTS } from "@lichtblick/suite-base/components/KeyboardShortcuts/appShortcuts";
import LayoutBrowser from "@lichtblick/suite-base/components/LayoutBrowser";
import LayoutHistoryList from "@lichtblick/suite-base/components/LayoutHistoryList";
import { LayoutTemplateCommands } from "@lichtblick/suite-base/components/LayoutTemplates";
import { LiveRecordingsDialog } from "@lichtblick/suite-base/components/LiveRecordingsDialog";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  selectIsPlaying,
  selectPausePlayback,
  selectPlayerId,
  selectPlayerPresence,
  selectRecordingFiles,
  selectSeekPlayback,
  selectStartPlayback,
} from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { MonitorSetupProvider } from "@lichtblick/suite-base/components/MonitorSetupContext";
import { PanelGuide } from "@lichtblick/suite-base/components/PanelDocs/PanelGuide";
import PanelLayout from "@lichtblick/suite-base/components/PanelLayout";
import PanelSettings from "@lichtblick/suite-base/components/PanelSettings";
import { COMPACT_PANELS_ATTRIBUTE } from "@lichtblick/suite-base/components/PanelToolbar/constants";
import PlaybackControls from "@lichtblick/suite-base/components/PlaybackControls";
import Sidebars from "@lichtblick/suite-base/components/Sidebars";
import { SidebarItem } from "@lichtblick/suite-base/components/Sidebars/types";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  StudioLogsSettings,
  StudioLogsSettingsSidebar,
} from "@lichtblick/suite-base/components/StudioLogsSettings/StudioLogsSettings";
import { SyncAdapters } from "@lichtblick/suite-base/components/SyncAdapters";
import { TopicList } from "@lichtblick/suite-base/components/TopicList/TopicList";
import VariablesList from "@lichtblick/suite-base/components/VariablesList";
import { WorkspaceDialogs } from "@lichtblick/suite-base/components/WorkspaceDialogs";
import { AllowedFileExtensions } from "@lichtblick/suite-base/constants/allowedFileExtensions";
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
import { useSaveSessionBeforeReload } from "@lichtblick/suite-base/hooks/useSaveSessionBeforeReload";
import useSeekTimeFromCLI from "@lichtblick/suite-base/hooks/useSeekTimeFromCLI";
import {
  playerSourceKey,
  takeResumePlayback,
} from "@lichtblick/suite-base/hooks/useServiceWorkerUpdate";
import { useStructureItemsStoreManager } from "@lichtblick/suite-base/panels/Plot/hooks/useStructureItemsStoreManager";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";
import { PanelStateContextProvider } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import WorkspaceContextProvider from "@lichtblick/suite-base/providers/WorkspaceContextProvider";
import { WorkspaceProps } from "@lichtblick/suite-base/types";
import { useAppLaunch } from "@lichtblick/suite-base/util/appLaunch";
import { parseAppURLState } from "@lichtblick/suite-base/util/appURLState";
import useBroadcast from "@lichtblick/suite-base/util/broadcast/useBroadcast";
import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";
import { shortcutKeyHandlers } from "@lichtblick/suite-base/util/keyboardShortcuts";
import { basename, extname } from "@lichtblick/suite-base/util/path";
import { pwaProtocolUrl } from "@lichtblick/suite-base/util/pwaProtocolUrl";
import { decodeSharedLayout, sharedLayoutFromHash } from "@lichtblick/suite-base/util/shareLink";

import { useWorkspaceActions } from "./context/Workspace/useWorkspaceActions";
import { severityToBadgeColor } from "./utils";

const log = Logger.getLogger(__filename);

// Loaded once a comparison is edited, so it costs nothing at startup
const CompareDialog = lazy(async () => ({
  default: (await import("@lichtblick/suite-base/components/Compare/CompareDialog")).CompareDialog,
}));

const selectPlayerIsPresent = ({ playerState }: MessagePipelineContext) =>
  playerState.presence !== PlayerPresence.NOT_PRESENT;
const selectPlayUntil = (ctx: MessagePipelineContext) => ctx.playUntil;
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
  const comparing = useCompareDialog((state) => state.draft != undefined);
  const leftSidebarItem = useWorkspaceStore(selectWorkspaceLeftSidebarItem);
  const leftSidebarOpen = useWorkspaceStore(selectWorkspaceLeftSidebarOpen);
  const leftSidebarSize = useWorkspaceStore(selectWorkspaceLeftSidebarSize);
  const rightSidebarItem = useWorkspaceStore(selectWorkspaceRightSidebarItem);
  const rightSidebarOpen = useWorkspaceStore(selectWorkspaceRightSidebarOpen);
  const rightSidebarSize = useWorkspaceStore(selectWorkspaceRightSidebarSize);
  const { AppBarComponent = AppBar } = props;

  const play = useMessagePipeline(selectStartPlayback);
  const playUntil = useMessagePipeline(selectPlayUntil);
  const pause = useMessagePipeline(selectPausePlayback);
  const seek = useMessagePipeline(selectSeekPlayback);
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
        pushAll(extensions, source.supportedFileTypes);
      }
    }
    return extensions;
  }, [availableSources]);

  // Keys the panel tree below so it remounts when the player changes
  const playerId = useMessagePipeline(selectPlayerId);

  useDefaultWebLaunchPreference();

  useStructureItemsStoreManager();

  const [enableDebugMode = false] = useAppConfigurationValue<boolean>(AppSetting.SHOW_DEBUG_PANELS);

  const [compactPanels = false] = useAppConfigurationValue<boolean>(AppSetting.COMPACT_PANELS);

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
      // A file launch supersedes any protocol launch still waiting on its layout or seek.
      if (files.length > 0) {
        layoutRequest.current?.abort();
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

  // Launches from inside the app, e.g. a catalog entry with its layout, apply like a link.
  const appLaunchURL = useAppLaunch((state) => state.url);
  useEffect(() => {
    if (appLaunchURL) {
      setLaunchedURL(appLaunchURL);
    }
  }, [appLaunchURL]);

  const dropHandler = useCallback(
    async ({ files, handles }: { files?: File[]; handles?: FileSystemFileHandle[] }) => {
      const filesArray = handles
        ? await Promise.all(handles.map(async (h) => await h.getFile()))
        : (files ?? []);

      void handleFiles(filesArray, undefined, handles);
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
  // Events come from the recording's foxglove.Event topics, no account needed
  const showEventsTab = eventsSupported;

  const hasAttachments = useMessagePipeline(
    (ctx) => selectRecordingFiles(ctx)?.some((file) => file.attachments.length > 0) ?? false,
  );

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
    if (hasAttachments) {
      // Like the events tab, shown only when there is something to show.
      items.set("attachments", { title: t("workspace:attachments"), component: AttachmentList });
    }
    return items;
  }, [PanelSettingsSidebar, alertCount, highestSeverity, hasAttachments]);

  const rightSidebarItems = useMemo(() => {
    const items = new Map<RightSidebarItemKey, SidebarItem>([
      [
        "variables",
        {
          title: t("workspace:variables"),
          component: VariablesList,
        },
      ],
      ["layout-history", { title: t("workspace:layoutHistory"), component: LayoutHistoryList }],
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

  const toggleColorScheme = useToggleColorScheme();
  const keyDownHandlers = useMemo(
    () =>
      shortcutKeyHandlers(APP_SHORTCUTS, {
        "app.toggleTheme": toggleColorScheme,
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
      toggleColorScheme,
    ],
  );

  const deepLink = props.deepLinks?.[0];
  // The layout a share link carries in its fragment (see util/shareLink), read once at launch.
  const [sharedLinkLayout] = useState(() => {
    try {
      return deepLink == undefined ? undefined : sharedLayoutFromHash(new URL(deepLink).hash);
    } catch {
      return undefined;
    }
  });
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
        urls?: readonly string[];
        layoutUrl?: string;
      }
    | undefined
  >(
    targetUrlState
      ? {
          ds: targetUrlState.ds,
          dsParams: targetUrlState.dsParams,
          urls: targetUrlState.dsParamsArray?.urls,
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
      state
        ? {
            ds: state.ds,
            dsParams: state.dsParams,
            urls: state.dsParamsArray?.urls,
            layoutUrl: state.layoutUrl,
          }
        : undefined,
    );
    setUnappliedTime({
      time: state?.time,
      previousPlayerId: state?.ds ? getMessagePipeline().playerState.playerId : undefined,
    });
  }, [launchedURL, getMessagePipeline]);

  const selectEvent = useEvents(selectSelectEvent);

  /**
   * Saves and selects a layout opened from a link, replacing earlier copies with the same name so
   * reopening links doesn't pile up layouts. Anyone can make such a link, so the layout is marked
   * untrusted: its user scripts wait for the user's approval.
   */
  const installLayoutText = useCallback(
    async (text: string, filename: string, signal: AbortSignal) => {
      const layoutName = basename(filename, extname(filename));

      // Find existing layouts with the same name before saving (safe deduplication)
      const existingLayouts = await layoutManager.getLayouts();
      const matchingLayouts = existingLayouts.filter((layout) => layout.name === layoutName);

      // Delegate JSON parsing, saving, and selection to parseAndInstallLayout
      const file = new File([text], filename, { type: "application/json" });
      const newLayout = await parseAndInstallLayout(file, "local", signal, { untrusted: true });

      // Only delete old layouts after successful save to avoid data loss
      if (newLayout) {
        for (const layout of matchingLayouts) {
          signal.throwIfAborted();
          await layoutManager.deleteLayout({ id: layout.id });
        }
      }
      return newLayout;
    },
    [layoutManager, parseAndInstallLayout],
  );

  /**
   * Whether the share link's layout got installed. Only the source the link opens waits for it,
   * once, so later launches show their own (e.g. a sample's) layout.
   */
  const sharedLayoutInstall = useRef<Promise<{ installed: boolean }>>(undefined);

  // A share link carries its layout in the fragment (see util/shareLink). Install it once, then
  // drop the fragment so a reload or a newly copied link doesn't reinstall a stale copy.
  // The fragment comes with the launch link: the page URL on the web, the `lichtblick://` link
  // on desktop.
  useEffect(() => {
    const encoded = sharedLinkLayout;
    if (encoded == undefined) {
      return;
    }
    if (sharedLayoutFromHash(window.location.hash) != undefined) {
      const url = new URL(window.location.href);
      url.hash = "";
      window.history.replaceState(undefined, "", url.href);
    }

    layoutRequest.current?.abort();
    const controller = new AbortController();
    layoutRequest.current = controller;
    sharedLayoutInstall.current = (async () => {
      try {
        const text = await decodeSharedLayout(encoded);
        controller.signal.throwIfAborted();
        const layout = await installLayoutText(text, "Shared layout.json", controller.signal);
        return { installed: layout != undefined };
      } catch (error) {
        if (!controller.signal.aborted) {
          log.error("Could not open the layout from the link", error);
          enqueueSnackbar("Could not open the layout from the link", { variant: "error" });
        }
        return { installed: false };
      }
    })();
    // Only the link the app was opened with carries a layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const text = await response.text();
        signal.throwIfAborted();
        await installLayoutText(text, filename, signal);
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        log.error(`Could not load layout from ${safeUrlLabel}`, error);
        enqueueSnackbar("Failed to load layout from URL", { variant: "error" });
      }
    },
    [installLayoutText, enqueueSnackbar],
  );

  // Load data source from URL.
  useEffect(() => {
    if (!unappliedSourceArgs) {
      return;
    }

    let shouldUpdate = false;

    // Apply any available data source args
    const { ds, dsParams, urls } = unappliedSourceArgs;
    if (ds) {
      log.debug("Initialising source from url", unappliedSourceArgs);
      const open = ({ installed }: { installed: boolean }) => {
        selectSource(ds, {
          type: "connection",
          params: dsParams,
          ...(urls != undefined && { urls }),
          // The link's layout is what the sender wants shown, not the sample's own.
          ...(installed && { keepLayout: true }),
        });
        selectEvent(dsParams?.eventId);
      };
      const layoutInstall = sharedLayoutInstall.current;
      sharedLayoutInstall.current = undefined;
      if (layoutInstall) {
        void layoutInstall.then(open);
      } else {
        open({ installed: false });
      }
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

  useSaveSessionBeforeReload();
  // An update reload resumes playback once it is back at the URL time, but only of the recording
  // that was playing: if that one fails to reopen, the next one the user opens must not start
  const [resumeSource, setResumeSource] = useState(takeResumePlayback);

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
    if (resumeSource != undefined) {
      setResumeSource(undefined);
      if (playerSourceKey(getMessagePipeline().playerState) === resumeSource) {
        play?.();
      }
    }
  }, [getMessagePipeline, play, playerId, playerPresence, resumeSource, seek, unappliedTime]);

  useSeekTimeFromCLI();

  const appBar = useMemo(
    () => (
      <AppBarComponent
        leftInset={props.appBarLeftInset}
        onDoubleClick={props.onAppBarDoubleClick}
      />
    ),
    [AppBarComponent, props.appBarLeftInset, props.onAppBarDoubleClick],
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
      <PanelGuide />
      <LiveRecordingsDialog />
      {comparing && (
        <Suspense fallback={undefined}>
          <CompareDialog />
        </Suspense>
      )}
      <div
        className={classes.container}
        ref={containerRef}
        tabIndex={0}
        {...{ [COMPACT_PANELS_ATTRIBUTE]: compactPanels ? "" : undefined }}
      >
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

  // `?catalog=<url>` opens on that catalog's recordings.
  const [catalogUrl] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : (new URL(window.location.href).searchParams.get("catalog") ?? undefined),
  );
  const initialItem: undefined | DataSourceDialogItem = isPlayerPresent
    ? undefined
    : catalogUrl != undefined
      ? "demo"
      : showOpenDialogOnStartup
        ? "start"
        : undefined;

  const initialState: Pick<WorkspaceContextStore, "dialogs"> = {
    dialogs: {
      dataSource: {
        activeDataSource: undefined,
        open: initialItem != undefined,
        item: initialItem,
        catalogUrl,
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
