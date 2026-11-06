// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time, subtract, toSec } from "@foxglove/rostime";
import { TFunction } from "i18next";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Logger from "@lichtblick/log";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { PLAYBACK_SPEED_OPTIONS } from "@lichtblick/suite-base/components/PlaybackSpeedControls";
import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";
import { LICHTBLICK_DOCUMENTATION_LINK } from "@lichtblick/suite-base/constants/documentation";
import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
  useSelectedPanels,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import { usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import {
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import useAddPanel from "@lichtblick/suite-base/hooks/useAddPanel";
import { useLayoutTransfer } from "@lichtblick/suite-base/hooks/useLayoutTransfer";
import { PlayerPresence, Topic } from "@lichtblick/suite-base/players/types";
import { PanelConfig } from "@lichtblick/suite-base/types/panels";
import { formatKeyboardShortcut } from "@lichtblick/suite-base/util/formatKeyboardShortcut";
import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";
import { PANEL_TITLE_CONFIG_KEY, getPanelTypeFromId } from "@lichtblick/suite-base/util/layout";
import { getPanelIds, setActivePanel } from "@lichtblick/suite-base/util/layoutTree";
import { formatTimeRaw } from "@lichtblick/suite-base/util/time";

import { Command, parseSeekInput } from "./commands";

const log = Logger.getLogger(__filename);

type TopicTarget = {
  panelType: string;
  config: (topic: string) => PanelConfig;
};

const RAW_MESSAGES: TopicTarget = {
  panelType: "RawMessages",
  config: (topic) => ({ topicPath: topic }),
};

/**
 * Picks the panels that can show a topic, best first. Matching is by schema name so it works for
 * ROS 1, ROS 2 and Foxglove schemas without hardcoding any topic names.
 */
export function topicTargets(schemaName: string | undefined): TopicTarget[] {
  const schema = schemaName ?? "";
  const targets: TopicTarget[] = [];
  if (/(^|[/.])(Raw|Compressed)?Image$/.test(schema)) {
    targets.push({
      panelType: "Image",
      config: (topic) => ({ imageMode: { imageTopic: topic } }),
    });
  }
  if (/(^|[/.])Log$/.test(schema)) {
    targets.push({
      panelType: "RosOut",
      config: (topic) => ({ topicToRender: topic }),
    });
  }
  if (/(^|[/.])DiagnosticArray$/.test(schema)) {
    targets.push({
      panelType: "DiagnosticSummary",
      config: (topic) => ({ topicToRender: topic }),
    });
  }
  if (
    /(PointCloud2?|LaserScan|Marker(Array)?|OccupancyGrid|Grid|Path|Pose(Stamped|Array|InFrame|sInFrame)?|TFMessage|FrameTransforms?|SceneUpdate|PolygonStamped)$/.test(
      schema,
    )
  ) {
    targets.push({
      panelType: "3D",
      config: (topic) => ({ topics: { [topic]: { visible: true } } }),
    });
  }
  targets.push(RAW_MESSAGES, {
    panelType: "Table",
    config: (topic) => ({ topicPath: topic }),
  });
  return targets;
}

/** Formats seconds as `m:ss.mmm` (or `h:mm:ss.mmm`), signed. */
export function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const totalMs = Math.round(Math.abs(seconds) * 1000);
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = ((totalMs % 60_000) / 1000).toFixed(3).padStart(6, "0");
  return h > 0 ? `${sign}${h}:${String(m).padStart(2, "0")}:${s}` : `${sign}${m}:${s}`;
}

const selectLeftSidebarOpen = (store: WorkspaceContextStore) => store.sidebars.left.open;
const selectLeftSidebarItem = (store: WorkspaceContextStore) => store.sidebars.left.item;
const selectLayout = (state: LayoutState) => state.selectedLayout;
const selectPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectIsPlaying = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.isPlaying === true;
const selectStart = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEnd = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectTopics = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.topics;
const selectPlay = (ctx: MessagePipelineContext) => ctx.startPlayback;
const selectPause = (ctx: MessagePipelineContext) => ctx.pausePlayback;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectSetSpeed = (ctx: MessagePipelineContext) => ctx.setPlaybackSpeed;

/** Wraps an async action as a sync callback that logs failures. */
function catchErrors(action: () => Promise<unknown>): () => void {
  return () => {
    action().catch((err: unknown) => {
      log.error(err);
    });
  };
}

/** Lists the global keyboard shortcuts as read-only palette entries. */
function shortcutCommands(t: TFunction<"commandPalette">): Command[] {
  const noop = () => {};
  const entries: [string, string][] = [
    [t("shortcutCommandPalette"), formatKeyboardShortcut("K", ["Meta"])],
    [t("shortcutOpenFile"), formatKeyboardShortcut("O", ["Meta"])],
    [t("shortcutOpenConnection"), formatKeyboardShortcut("O", ["Meta", "Shift"])],
    [t("shortcutPlayPause"), "Space"],
    [t("shortcutStep"), "← / →"],
    [t("toggleLeftSidebar"), "["],
    [t("toggleRightSidebar"), "]"],
    [t("togglePanelSettings"), ","],
  ];
  return entries.map(([title, shortcut]) => ({
    id: `shortcut:${title}`,
    title,
    shortcut,
    run: noop,
  }));
}

/**
 * Builds the app's built-in commands from current state. Only commands that apply right now are
 * returned, e.g. playback commands need a loaded data source and panel commands need a layout.
 */
export function useAppCommands(): {
  commands: Command[];
  queryCommands: (query: string) => Command[];
} {
  const { t } = useTranslation("commandPalette");
  const { availableSources, recentSources, selectRecent } = usePlayerSelection();
  const { dialogActions, sidebarActions, openPanelSettings } = useWorkspaceActions();
  const leftSidebarOpen = useWorkspaceStore(selectLeftSidebarOpen);
  const leftSidebarItem = useWorkspaceStore(selectLeftSidebarItem);
  const layoutManager = useLayoutManager();
  const { setSelectedLayoutId, setPlaybackConfig, changePanelLayout, getCurrentLayoutState } =
    useCurrentLayoutActions();
  const { setSelectedPanelIds } = useSelectedPanels();
  const selectedLayout = useCurrentLayoutSelector(selectLayout);
  const panelCatalog = usePanelCatalog();
  const addPanel = useAddPanel();
  const { importLayout, exportLayout } = useLayoutTransfer();

  const presence = useMessagePipeline(selectPresence);
  const isPlaying = useMessagePipeline(selectIsPlaying);
  const startTime = useMessagePipeline(selectStart);
  const endTime = useMessagePipeline(selectEnd);
  const topics = useMessagePipeline(selectTopics);
  const play = useMessagePipeline(selectPlay);
  const pause = useMessagePipeline(selectPause);
  const seek = useMessagePipeline(selectSeek);
  const setSpeed = useMessagePipeline(selectSetSpeed);
  // Read the current time lazily so the palette does not re-render on every frame.
  const getPipeline = useMessagePipelineGetter();

  const commands = useMemo(() => {
    const list: Command[] = [];
    const push = (group: string, ...items: Command[]) => {
      list.push(...items.map((item) => ({ ...item, group })));
    };

    // ---- Open ----
    const remoteFile = availableSources.find((source) => source.id === "remote-file");
    push(
      t("groupOpen"),
      {
        id: "open.file",
        title: t("openFile"),
        keywords: ["mcap", "bag", "recording"],
        shortcut: formatKeyboardShortcut("O", ["Meta"]),
        run: catchErrors(dialogActions.openFile.open),
      },
      {
        id: "open.dialog",
        title: t("openDataSource"),
        run: () => {
          dialogActions.dataSource.open("start");
        },
      },
    );
    if (remoteFile) {
      push(t("groupOpen"), {
        id: "open.url",
        title: t("openUrl"),
        keywords: ["remote", "http"],
        run: () => {
          dialogActions.dataSource.open("connection", remoteFile);
        },
      });
    }
    for (const source of availableSources) {
      if (source.type !== "connection" || source.hidden === true || source === remoteFile) {
        continue;
      }
      push(t("groupOpen"), {
        id: `open.connection.${source.id}`,
        title: t("openConnection", { name: source.displayName }),
        detail: source.description,
        keywords: ["connect", "live"],
        shortcut: formatKeyboardShortcut("O", ["Meta", "Shift"]),
        run: () => {
          dialogActions.dataSource.open("connection", source);
        },
      });
    }
    if (recentSources.length > 0) {
      push(t("groupOpen"), {
        id: "open.recent",
        title: t("openRecent"),
        placeholder: t("openRecentPlaceholder"),
        children: () =>
          recentSources.map((recent) => ({
            id: `open.recent.${recent.id}`,
            title: recent.title,
            detail: recent.label,
            run: () => {
              selectRecent(recent.id);
            },
          })),
      });
    }
    if (!isDesktopApp()) {
      push(t("groupOpen"), {
        id: "open.new-tab",
        title: t("newTab"),
        keywords: ["window"],
        run: () => {
          window.open(window.location.origin + window.location.pathname, "_blank", "noopener");
        },
      });
    }

    // ---- Layout ----
    push(
      t("groupLayout"),
      {
        id: "layout.switch",
        title: t("switchLayout"),
        keywords: ["switch", "select"],
        placeholder: t("switchLayoutPlaceholder"),
        children: async () =>
          [...(await layoutManager.getLayouts())]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((layout) => ({
              id: `layout.switch.${layout.id}`,
              title: layout.name,
              detail: layout.id === selectedLayout?.id ? t("currentLayout") : undefined,
              run: () => {
                setSelectedLayoutId(layout.id);
              },
            })),
      },
      {
        id: "layout.browse",
        title: t("browseLayouts"),
        run: () => {
          sidebarActions.left.selectItem("layouts");
        },
      },
      {
        id: "layout.import",
        title: t("importLayout"),
        run: catchErrors(importLayout),
      },
    );
    if (selectedLayout) {
      push(t("groupLayout"), {
        id: "layout.export",
        title: t("exportLayout"),
        run: catchErrors(exportLayout),
      });
    }

    // ---- Panels ----
    const layoutData = selectedLayout?.data;
    if (layoutData) {
      const panelIds = layoutData.layout != undefined ? getPanelIds(layoutData.layout) : [];
      // Selecting a panel in a background tab would leave it hidden, so bring its tab to front too
      // Reads the layout when picked: it may have changed since the list was built.
      // Returns false when the panel was removed meanwhile.
      const revealPanel = (id: string): boolean => {
        const layout = getCurrentLayoutState().selectedLayout?.data?.layout;
        if (layout == undefined || !getPanelIds(layout).includes(id)) {
          return false;
        }
        changePanelLayout({ layout: setActivePanel(layout, id) });
        setSelectedPanelIds([id]);
        return true;
      };
      const panelCommands = (idPrefix: string, onPick: (id: string) => void) => () =>
        panelIds.map((id) => {
          const type = getPanelTypeFromId(id);
          const customTitle = layoutData.configById[id]?.[PANEL_TITLE_CONFIG_KEY];
          const typeTitle = panelCatalog.getPanelByType(type)?.title ?? type;
          const hasCustomTitle = typeof customTitle === "string" && customTitle !== "";
          return {
            id: `${idPrefix}.${id}`,
            title: hasCustomTitle ? customTitle : typeTitle,
            detail: hasCustomTitle ? typeTitle : undefined,
            run: () => {
              onPick(id);
            },
          };
        });
      push(t("groupPanel"), {
        id: "panel.add",
        title: t("addPanel"),
        keywords: ["new", "create"],
        placeholder: t("addPanelPlaceholder"),
        children: () =>
          panelCatalog.getPanels().map((info) => ({
            id: `panel.add.${info.type}`,
            title: info.title,
            detail: info.description,
            run: () => {
              addPanel({ type: info.type, config: info.config });
            },
          })),
      });
      if (panelIds.length > 0) {
        push(
          t("groupPanel"),
          {
            id: "panel.focus",
            title: t("focusPanel"),
            keywords: ["select", "go to"],
            placeholder: t("focusPanelPlaceholder"),
            children: panelCommands("panel.focus", (id) => {
              revealPanel(id);
            }),
          },
          {
            id: "panel.settings",
            title: t("panelSettings"),
            keywords: ["config", "edit"],
            placeholder: t("focusPanelPlaceholder"),
            children: panelCommands("panel.settings", (id) => {
              if (revealPanel(id)) {
                openPanelSettings();
              }
            }),
          },
        );
      }
    }

    // ---- Topics ----
    if (layoutData && topics && topics.length > 0) {
      push(t("groupTopic"), {
        id: "topic.open",
        title: t("openTopic"),
        keywords: ["show", "view"],
        placeholder: t("openTopicPlaceholder"),
        children: () =>
          [...topics]
            .sort((a, b) => a.name.localeCompare(b.name))
            .flatMap((topic: Topic) =>
              topicTargets(topic.schemaName).map((target) => {
                const panelTitle =
                  panelCatalog.getPanelByType(target.panelType)?.title ?? target.panelType;
                return {
                  id: `topic.open.${target.panelType}.${topic.name}`,
                  title: topic.name,
                  detail: topic.schemaName,
                  group: t("openTopicIn", { panel: panelTitle }),
                  run: () => {
                    addPanel({
                      type: target.panelType,
                      config: target.config(topic.name),
                    });
                  },
                };
              }),
            ),
      });
    }

    // ---- Playback ----
    const hasPlayer = presence === PlayerPresence.PRESENT;
    if (hasPlayer && play && pause) {
      push(t("groupPlayback"), {
        id: "playback.toggle",
        title: isPlaying ? t("pause") : t("play"),
        keywords: ["play", "pause", "resume", "stop"],
        shortcut: "Space",
        run: isPlaying ? pause : play,
      });
    }
    if (hasPlayer && seek && startTime && endTime) {
      push(
        t("groupPlayback"),
        {
          id: "playback.start",
          title: t("seekToStart"),
          keywords: ["beginning"],
          run: () => {
            seek(startTime);
          },
        },
        {
          id: "playback.end",
          title: t("seekToEnd"),
          run: () => {
            seek(endTime);
          },
        },
      );
    }
    if (hasPlayer && setSpeed) {
      push(t("groupPlayback"), {
        id: "playback.speed",
        title: t("playbackSpeed"),
        keywords: ["rate", "faster", "slower"],
        placeholder: t("playbackSpeedPlaceholder"),
        children: () =>
          PLAYBACK_SPEED_OPTIONS.map((speed) => ({
            id: `playback.speed.${speed}`,
            title: `${speed}×`,
            run: () => {
              setPlaybackConfig({ speed });
              setSpeed(speed);
            },
          })),
      });
    }

    // ---- View ----
    push(
      t("groupView"),
      {
        id: "view.left-sidebar",
        title: t("toggleLeftSidebar"),
        shortcut: "[",
        run: () => {
          sidebarActions.left.setOpen((open) => !open);
        },
      },
      {
        id: "view.right-sidebar",
        title: t("toggleRightSidebar"),
        shortcut: "]",
        run: () => {
          sidebarActions.right.setOpen((open) => !open);
        },
      },
      {
        id: "view.panel-settings",
        title: t("togglePanelSettings"),
        shortcut: ",",
        run: () => {
          sidebarActions.left.selectItem(
            leftSidebarOpen && leftSidebarItem === "panel-settings" ? undefined : "panel-settings",
          );
        },
      },
      {
        id: "view.settings",
        title: t("settings"),
        keywords: ["preferences", "theme", "language"],
        run: () => {
          dialogActions.preferences.open();
        },
      },
    );

    // ---- Help ----
    push(
      t("groupHelp"),
      {
        id: "help.docs",
        title: t("documentation"),
        keywords: ["docs", "manual"],
        run: () => {
          window.open(LICHTBLICK_DOCUMENTATION_LINK, "_blank", "noopener,noreferrer");
        },
      },
      {
        id: "help.about",
        title: t("about"),
        detail: t("version", { version: APP_CONFIG.version }),
        keywords: ["version", "license"],
        run: () => {
          dialogActions.preferences.open("about");
        },
      },
      {
        id: "help.shortcuts",
        title: t("keyboardShortcuts"),
        keywords: ["hotkeys", "keys", "keybindings"],
        placeholder: t("keyboardShortcutsPlaceholder"),
        children: () => shortcutCommands(t),
      },
    );
    return list;
  }, [
    addPanel,
    availableSources,
    dialogActions,
    endTime,
    exportLayout,
    importLayout,
    isPlaying,
    layoutManager,
    leftSidebarItem,
    leftSidebarOpen,
    openPanelSettings,
    panelCatalog,
    pause,
    play,
    presence,
    recentSources,
    seek,
    selectRecent,
    selectedLayout,
    setPlaybackConfig,
    changePanelLayout,
    getCurrentLayoutState,
    setSelectedLayoutId,
    setSelectedPanelIds,
    setSpeed,
    sidebarActions,
    startTime,
    t,
    topics,
  ]);

  const queryCommands = useCallback(
    (query: string): Command[] => {
      if (presence !== PlayerPresence.PRESENT || !seek || !startTime || !endTime) {
        return [];
      }
      const current = getPipeline().playerState.activeData?.currentTime;
      const target = parseSeekInput(query, {
        start: startTime,
        end: endTime,
        current,
      });
      if (!target) {
        return [];
      }
      const offsetFromStart = toSec(subtract(target.time, startTime));
      const delta = current ? toSec(subtract(target.time, current)) : 0;
      const seekTime: Time = target.time;
      return [
        {
          id: "playback.seek",
          title: target.relative
            ? t("seekBy", {
                offset: `${delta >= 0 ? "+" : ""}${formatOffset(delta)}`,
              })
            : t("seekTo", { offset: formatOffset(offsetFromStart) }),
          detail: `${formatOffset(offsetFromStart)} · ${formatTimeRaw(seekTime)}`,
          group: t("groupPlayback"),
          run: () => {
            seek(seekTime);
          },
        },
      ];
    },
    [endTime, getPipeline, presence, seek, startTime, t],
  );

  return { commands, queryCommands };
}
