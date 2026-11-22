// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time, subtract, toSec } from "@foxglove/rostime";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { pushAll } from "@lichtblick/den/collection";
import Logger from "@lichtblick/log";
import { MessagePathStructureItem } from "@lichtblick/message-path";
import { useToggleColorScheme } from "@lichtblick/suite-base/components/ColorSchemeThemeProvider";
import { useShowCompareDialog } from "@lichtblick/suite-base/components/Compare/CompareDialog";
import { useKeyboardShortcutsStore } from "@lichtblick/suite-base/components/KeyboardShortcuts/KeyboardShortcuts";
import {
  APP_SHORTCUTS,
  PLAYBACK_SHORTCUTS,
} from "@lichtblick/suite-base/components/KeyboardShortcuts/appShortcuts";
import { useStructureItemsByPathStore } from "@lichtblick/suite-base/components/MessagePathSyntax/useStructureItemsByPathStore";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  selectEndTime,
  selectIsPlaying,
  selectPausePlayback,
  selectPlayerPresence,
  selectSeekPlayback,
  selectStartPlayback,
  selectStartTime,
} from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { usePanelGuideStore } from "@lichtblick/suite-base/components/PanelDocs/PanelGuide";
import { PLAYBACK_SPEED_OPTIONS } from "@lichtblick/suite-base/components/PlaybackSpeedControls";
import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";
import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
  useSelectedPanels,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { AddPanelPayload } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import { PanelInfo, usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import {
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import useAddPanel from "@lichtblick/suite-base/hooks/useAddPanel";
import { useLayoutTransfer } from "@lichtblick/suite-base/hooks/useLayoutTransfer";
import { useShareLink } from "@lichtblick/suite-base/hooks/useShareLink";
import { DEFAULT_PLOT_PATH } from "@lichtblick/suite-base/panels/Plot/constants";
import { newRow } from "@lichtblick/suite-base/panels/Watch/config";
import { PLOTABLE_ROS_TYPES } from "@lichtblick/suite-base/panels/shared/constants";
import { PlayerPresence, Topic } from "@lichtblick/suite-base/players/types";
import { PanelConfig } from "@lichtblick/suite-base/types/panels";
import clipboard from "@lichtblick/suite-base/util/clipboard";
import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";
import { shortcutLabel } from "@lichtblick/suite-base/util/keyboardShortcuts";
import {
  PANEL_TITLE_CONFIG_KEY,
  getPanelIdForType,
  getPanelTypeFromId,
  isPlainObject,
} from "@lichtblick/suite-base/util/layout";
import { getPanelIds, setActivePanel } from "@lichtblick/suite-base/util/layoutTree";
import { formatTimeRaw } from "@lichtblick/suite-base/util/time";

import { Command, RankedCommand, matchMessagePaths, parseSeekInput } from "./commands";
import { LAYOUT_SHORTCUTS } from "./layoutShortcuts";

const log = Logger.getLogger(__filename);

type TopicTarget = {
  panelType: string;
  /** Config of a new panel showing `value` (a topic or message path). */
  config: (value: string) => PanelConfig;
  /** Config of an existing panel of this type after showing `value` in it too, or instead. */
  apply: (prev: PanelConfig, value: string) => PanelConfig;
  /** The panel reads its config only on mount (3D, Image), so changing it means replacing it. */
  remount?: true;
};

const obj = (value: unknown): Record<string, unknown> => (isPlainObject(value) ? value : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Panels whose config names one topic: picking a topic replaces it. */
const singleTopic = (panelType: string, key: string): TopicTarget => ({
  panelType,
  config: (topic) => ({ [key]: topic }),
  apply: (prev, topic) => ({ ...prev, [key]: topic }),
});

const RAW_MESSAGES = singleTopic("RawMessages", "topicPath");

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
      remount: true,
      config: (topic) => ({ imageMode: { imageTopic: topic } }),
      apply: (prev, topic) => ({
        ...prev,
        imageMode: { ...obj(prev.imageMode), imageTopic: topic },
      }),
    });
  }
  if (/(^|[/.])Log$/.test(schema)) {
    targets.push(singleTopic("RosOut", "topicToRender"));
  }
  if (/(^|[/.])DiagnosticArray$/.test(schema)) {
    targets.push(singleTopic("DiagnosticSummary", "topicToRender"));
  }
  if (
    /(PointCloud2?|LaserScan|Marker(Array)?|OccupancyGrid|Grid|Path|Pose(Stamped|Array|InFrame|sInFrame)?|TFMessage|FrameTransforms?|SceneUpdate|PolygonStamped)$/.test(
      schema,
    )
  ) {
    targets.push({
      panelType: "3D",
      remount: true,
      config: (topic) => ({ topics: { [topic]: { visible: true } } }),
      // Turns the topic on in the scene; other topics stay as they are.
      apply: (prev, topic) => {
        const topics = obj(prev.topics);
        return {
          ...prev,
          topics: { ...topics, [topic]: { ...obj(topics[topic]), visible: true } },
        };
      },
    });
  }
  targets.push(RAW_MESSAGES, singleTopic("Table", "topicPath"));
  return targets;
}

/** Plot and Watch show many paths, so picking one adds it. */
const PLOT: TopicTarget = {
  panelType: "Plot",
  config: (path) => ({ paths: [{ ...DEFAULT_PLOT_PATH, value: path }] }),
  apply: (prev, path) => ({
    ...prev,
    // Fill the empty series of a fresh plot instead of adding a second one.
    paths: [
      ...asArray(prev.paths).filter((p) => obj(p).value !== ""),
      { ...DEFAULT_PLOT_PATH, value: path },
    ],
  }),
};
const WATCH: TopicTarget = {
  panelType: "Watch",
  config: (path) => ({ rows: [newRow(path)] }),
  apply: (prev, path) => ({ ...prev, rows: [...asArray(prev.rows), newRow(path)] }),
};

/**
 * Panels for a message path, best first. Plottable values go to a plot; anything else is watched.
 * A path without a known structure (typed with a modifier or filter) is assumed plottable.
 */
export function pathTargets(item: MessagePathStructureItem | undefined): TopicTarget[] {
  const plottable =
    item == undefined ||
    (item.structureType === "primitive" && PLOTABLE_ROS_TYPES.includes(item.primitiveType));
  return plottable ? [PLOT, WATCH, RAW_MESSAGES] : [WATCH, RAW_MESSAGES];
}

/** Short type label for a message path result, e.g. `float64` or `geometry_msgs/Pose`. */
export function itemTypeName(item: MessagePathStructureItem): string {
  switch (item.structureType) {
    case "primitive":
      return item.primitiveType;
    case "array":
      return `${itemTypeName(item.next)}[]`;
    case "message":
      return item.datatype;
  }
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
const selectTopics = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.topics;
const selectSetSpeed = (ctx: MessagePipelineContext) => ctx.setPlaybackSpeed;

/** Wraps an async action as a sync callback that logs failures. */
function catchErrors(action: () => Promise<unknown>): () => void {
  return () => {
    action().catch((err: unknown) => {
      log.error(err);
    });
  };
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
  const showShortcuts = useKeyboardShortcutsStore((state) => state.show);
  const toggleColorScheme = useToggleColorScheme();
  const showCompare = useShowCompareDialog();
  const { recentSources, selectRecent } = usePlayerSelection();
  const { dialogActions, sidebarActions, openPanelSettings } = useWorkspaceActions();
  const leftSidebarOpen = useWorkspaceStore(selectLeftSidebarOpen);
  const leftSidebarItem = useWorkspaceStore(selectLeftSidebarItem);
  const layoutManager = useLayoutManager();
  const layoutActions = useCurrentLayoutActions();
  const {
    setSelectedLayoutId,
    setPlaybackConfig,
    changePanelLayout,
    getCurrentLayoutState,
    savePanelConfigs,
    splitPanel,
    swapPanel,
    closePanel,
  } = layoutActions;
  const { selectedPanelIds, setSelectedPanelIds } = useSelectedPanels();
  const selectedLayout = useCurrentLayoutSelector(selectLayout);
  const panelCatalog = usePanelCatalog();
  const addPanel = useAddPanel();
  const { importLayout, exportLayout } = useLayoutTransfer();

  const presence = useMessagePipeline(selectPlayerPresence);
  const isPlaying = useMessagePipeline(selectIsPlaying);
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const topics = useMessagePipeline(selectTopics);
  const play = useMessagePipeline(selectStartPlayback);
  const pause = useMessagePipeline(selectPausePlayback);
  const seek = useMessagePipeline(selectSeekPlayback);
  const setSpeed = useMessagePipeline(selectSetSpeed);
  // Read the current time lazily so the palette does not re-render on every frame.
  const getPipeline = useMessagePipelineGetter();
  const { availability: shareAvailability, copyLink: copyShareLink } = useShareLink();

  const commands = useMemo(() => {
    const list: Command[] = [];
    const push = (group: string, ...items: Command[]) => {
      pushAll(
        list,
        items.map((item) => ({ ...item, group })),
      );
    };

    // ---- Open ----
    push(
      t("groupOpen"),
      {
        id: "open.file",
        title: t("openFile"),
        keywords: ["mcap", "bag", "recording"],
        shortcut: shortcutLabel(APP_SHORTCUTS, "app.openFile"),
        run: catchErrors(dialogActions.openFile.open),
      },
      {
        id: "open.compare",
        title: t("compareRecordings"),
        keywords: ["mcap", "diff", "side by side", "recording"],
        run: showCompare,
      },
      {
        id: "open.dialog",
        title: t("openDataSource"),
        run: () => {
          dialogActions.dataSource.open("start");
        },
      },
    );
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
        prefix: "#",
        children: async () =>
          [...(await layoutManager.getLayouts())]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((layout) => ({
              id: `layout.switch.${layout.id}`,
              title: layout.name,
              detail: layout.id === selectedLayout?.id ? t("currentLayout") : undefined,
              run: () => {
                if (layout.id !== selectedLayout?.id) {
                  setSelectedLayoutId(layout.id);
                }
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
      push(
        t("groupLayout"),
        {
          id: "layout.export",
          title: t("exportLayout"),
          run: catchErrors(exportLayout),
        },
        ...LAYOUT_SHORTCUTS.map((s) => ({
          id: s.id,
          title: t(s.titleKey),
          keywords: ["history"],
          shortcut: s.shortcut(),
          run: () => {
            s.run(layoutActions);
          },
        })),
      );
    }

    // ---- Panels ----
    const layoutData = selectedLayout?.data;
    const panelLabel = (id: string): { title: string; detail?: string } => {
      const type = getPanelTypeFromId(id);
      const customTitle = layoutData?.configById[id]?.[PANEL_TITLE_CONFIG_KEY];
      const typeTitle = panelCatalog.getPanelByType(type)?.title ?? type;
      return typeof customTitle === "string" && customTitle !== ""
        ? { title: customTitle, detail: typeTitle }
        : { title: typeTitle };
    };
    const panelTitle = (type: string) => panelCatalog.getPanelByType(type)?.title ?? type;
    const selectedTarget = selectedPanelIds.length === 1 ? selectedPanelIds[0] : undefined;
    /** Where else a new panel can go: next to the selected panel, or at an edge of the layout. */
    const placementActions = (idPrefix: string, type: string, config?: PanelConfig): Command[] => {
      const place = (key: string, title: string, payload: Partial<AddPanelPayload>): Command => ({
        id: `${idPrefix}.place.${key}`,
        title,
        run: () => {
          layoutActions.addPanel({ id: getPanelIdForType(type), config, ...payload });
        },
      });
      const near: Command[] =
        selectedTarget == undefined
          ? []
          : (
              [
                ["right-of", "placeRightOf", "right"],
                ["below", "placeBelow", "bottom"],
                ["tab-with", "placeTabWith", "center"],
              ] as const
            ).map(([key, label, position]) =>
              place(key, t(label, { panel: panelLabel(selectedTarget).title }), {
                position,
                targetPanelId: selectedTarget,
              }),
            );
      const edges = [
        ["left", "placeLeftEdge"],
        ["right", "placeRightEdge"],
        ["top", "placeTopEdge"],
        ["bottom", "placeBottomEdge"],
      ] as const;
      return [
        ...near,
        ...edges.map(([position, label]) => place(position, t(label), { position })),
      ];
    };
    /** Adds a panel where the palette always puts it; Tab offers other places. */
    const addPanelCommand = (
      id: string,
      type: string,
      config: PanelConfig | undefined,
      fields: Pick<Command, "title" | "detail" | "group" | "keywords">,
    ): Command => ({
      ...fields,
      id,
      run: () => {
        addPanel({ type, config });
      },
      actions: () => placementActions(id, type, config),
    });
    const selectedType =
      selectedTarget != undefined ? getPanelTypeFromId(selectedTarget) : undefined;
    /**
     * Shows a topic or path. With a panel of the target's type selected it goes into that panel
     * (e.g. switches the selected Image panel's topic); otherwise it adds a new panel. Tab offers
     * the other choice and the placements.
     */
    const showCommand = (
      id: string,
      target: TopicTarget,
      value: string,
      fields: Pick<Command, "title" | "detail" | "keywords">,
    ): Command => {
      const add = addPanelCommand(id, target.panelType, target.config(value), {
        ...fields,
        group: t("openTopicIn", { panel: panelTitle(target.panelType) }),
      });
      if (selectedTarget == undefined || selectedType !== target.panelType) {
        return add;
      }
      const panelId = selectedTarget;
      return {
        ...fields,
        id,
        group: t("showInSelected", { panel: panelLabel(panelId).title }),
        run: () => {
          // Read the config when picked so edits made since the palette opened are kept.
          const prev = getCurrentLayoutState().selectedLayout?.data?.configById[panelId] ?? {};
          const config = target.apply(prev, value);
          if (target.remount) {
            // Same place in the layout, new id, so the panel starts again with the new config.
            const newId = getPanelIdForType(target.panelType);
            swapPanel({ originalId: panelId, type: target.panelType, config, newId });
            setSelectedPanelIds([newId]);
            return;
          }
          savePanelConfigs({ configs: [{ id: panelId, config, override: true }] });
        },
        actions: () => [{ ...add, id: `${id}.new`, title: t("addAsNewPanel"), group: undefined }],
      };
    };
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
      const panelActions = (idPrefix: string, id: string): Command[] => [
        {
          id: `${idPrefix}.settings`,
          title: t("panelSettingsAction"),
          run: () => {
            if (revealPanel(id)) {
              openPanelSettings();
            }
          },
        },
        {
          id: `${idPrefix}.duplicate`,
          title: t("duplicatePanel"),
          run: () => {
            splitPanel({ id, direction: "row", config: layoutData.configById[id] ?? {} });
          },
        },
        {
          id: `${idPrefix}.close`,
          title: t("closePanel"),
          run: () => {
            closePanel({ id });
          },
        },
      ];
      const panelCommands = (idPrefix: string, onPick: (id: string) => void) => () =>
        panelIds.map(
          (id): Command => ({
            id: `${idPrefix}.${id}`,
            ...panelLabel(id),
            // Renamed panels stay findable by their type, e.g. "plot".
            keywords: [panelLabel(id).detail ?? "", getPanelTypeFromId(id)],
            run: () => {
              onPick(id);
            },
            actions: () => panelActions(`${idPrefix}.${id}`, id),
          }),
        );
      const catalogCommand = (info: PanelInfo) =>
        addPanelCommand(`panel.add.${info.type}`, info.type, info.config, {
          title: info.title,
          detail: info.description,
          keywords: [info.type, ...(info.keywords ?? [])],
        });
      push(t("groupPanel"), {
        id: "panel.add",
        title: t("addPanel"),
        keywords: ["new", "create"],
        placeholder: t("addPanelPlaceholder"),
        children: () => panelCatalog.getPanels().map(catalogCommand),
      });
      // Also at the root, so typing "tf" or "plot" offers the panel directly. Same ids as the
      // sub-menu entries so recents are shared.
      push(
        t("groupAddPanel"),
        ...panelCatalog.getPanels().map((info) => ({
          ...catalogCommand(info),
          searchOnly: true,
        })),
      );
      if (panelIds.length > 0) {
        push(
          t("groupPanel"),
          {
            id: "panel.focus",
            title: t("focusPanel"),
            keywords: ["select", "go to"],
            placeholder: t("focusPanelPlaceholder"),
            prefix: "@",
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
      const pathCommands = (query: string): RankedCommand[] =>
        matchMessagePaths(
          query,
          topics.map((topic) => topic.name),
          useStructureItemsByPathStore.getState().structureItemsByPath,
        ).map(({ path, item, positions }) => {
          // The selected panel's type goes first, so Enter adds the path to that panel.
          const targets = pathTargets(item).sort(
            (a, b) => Number(b.panelType === selectedType) - Number(a.panelType === selectedType),
          );
          const [first, ...rest] = targets.map((target) =>
            showCommand(`topic.path.${target.panelType}`, target, path, { title: path }),
          );
          return {
            command: {
              ...first!,
              id: `topic.path.${path}`,
              detail: item ? itemTypeName(item) : undefined,
              // Tab lists every panel for this path; Tab again picks where it goes.
              actions: () =>
                [first!, ...rest].map((cmd, i) => ({
                  ...cmd,
                  title: cmd.group ?? panelTitle(targets[i]!.panelType),
                  group: undefined,
                })),
            },
            positions,
          };
        });
      push(t("groupTopic"), {
        id: "topic.open",
        title: t("openTopic"),
        keywords: ["show", "view"],
        placeholder: t("openTopicPlaceholder"),
        prefix: "/",
        queryChildren: pathCommands,
        children: () =>
          [...topics]
            .sort((a, b) => a.name.localeCompare(b.name))
            .flatMap((topic: Topic) =>
              topicTargets(topic.schemaName).map((target) => {
                const id = `topic.open.${target.panelType}.${topic.name}`;
                const open = showCommand(id, target, topic.name, {
                  title: topic.name,
                  detail: topic.schemaName,
                });
                return {
                  ...open,
                  actions: () => [
                    {
                      id: `${id}.copy`,
                      title: t("copyTopicName"),
                      run: catchErrors(async () => {
                        await navigator.clipboard.writeText(topic.name);
                      }),
                    },
                    ...(open.actions?.() ?? []),
                  ],
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
        shortcut: shortcutLabel(PLAYBACK_SHORTCUTS, "playback.playPause"),
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

    // ---- Share ----
    if (shareAvailability !== "none") {
      push(t("groupShare"), {
        id: "share.link",
        title: t("copyLink"),
        detail: shareAvailability === "local" ? t("copyLinkLocalDetail") : t("copyLinkDetail"),
        keywords: ["share", "url", "permalink"],
        run: catchErrors(copyShareLink),
      });
    }
    if (hasPlayer) {
      push(t("groupShare"), {
        id: "share.timestamp",
        title: t("copyTimestamp"),
        keywords: ["time", "stamp", "copy"],
        run: catchErrors(async () => {
          const current = getPipeline().playerState.activeData?.currentTime;
          if (current) {
            await clipboard.copy(formatTimeRaw(current));
          }
        }),
      });
    }

    // ---- View ----
    push(
      t("groupView"),
      {
        id: "view.left-sidebar",
        title: t("toggleLeftSidebar"),
        shortcut: shortcutLabel(APP_SHORTCUTS, "app.toggleLeftSidebar"),
        run: () => {
          sidebarActions.left.setOpen((open) => !open);
        },
      },
      {
        id: "view.right-sidebar",
        title: t("toggleRightSidebar"),
        shortcut: shortcutLabel(APP_SHORTCUTS, "app.toggleRightSidebar"),
        run: () => {
          sidebarActions.right.setOpen((open) => !open);
        },
      },
      {
        id: "view.panel-settings",
        title: t("togglePanelSettings"),
        shortcut: shortcutLabel(APP_SHORTCUTS, "app.togglePanelSettings"),
        run: () => {
          sidebarActions.left.selectItem(
            leftSidebarOpen && leftSidebarItem === "panel-settings" ? undefined : "panel-settings",
          );
        },
      },
      {
        id: "view.toggle-theme",
        title: t("toggleTheme"),
        keywords: ["theme", "dark", "light", "color scheme"],
        shortcut: shortcutLabel(APP_SHORTCUTS, "app.toggleTheme"),
        run: toggleColorScheme,
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
        id: "help.panelGuide",
        title: t("panelGuide"),
        keywords: ["docs", "documentation", "manual", "help"],
        run: () => {
          usePanelGuideStore.getState().show();
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
        shortcut: shortcutLabel(APP_SHORTCUTS, "app.showShortcuts"),
        run: showShortcuts,
      },
    );
    return list;
  }, [
    addPanel,
    showCompare,
    dialogActions,
    endTime,
    exportLayout,
    importLayout,
    isPlaying,
    layoutActions,
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
    selectedPanelIds,
    setPlaybackConfig,
    changePanelLayout,
    closePanel,
    copyShareLink,
    getCurrentLayoutState,
    getPipeline,
    savePanelConfigs,
    splitPanel,
    swapPanel,
    setSelectedLayoutId,
    setSelectedPanelIds,
    setSpeed,
    shareAvailability,
    showShortcuts,
    toggleColorScheme,
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
