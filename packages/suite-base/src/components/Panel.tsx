// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Delete20Regular,
  TabDesktop20Regular,
  SplitVertical20Regular,
  SplitHorizontal20Regular,
} from "@fluentui/react-icons";
import React, {
  ComponentType,
  MouseEventHandler,
  Profiler,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Transition } from "react-transition-group";
import { useMountedState } from "react-use";

import { useShallowMemo } from "@lichtblick/hooks";
import { useConfigById } from "@lichtblick/suite-base/PanelAPI";
import { useCompare } from "@lichtblick/suite-base/components/Compare/CompareContext";
import { ComparedPanel } from "@lichtblick/suite-base/components/Compare/ComparedPanel";
import {
  COMPARE_VIEW_CONFIG_KEY,
  CompareView,
  compareSupport,
} from "@lichtblick/suite-base/components/Compare/compareView";
import { DockPanelContext } from "@lichtblick/suite-base/components/DockPanelContext";
import KeyListener from "@lichtblick/suite-base/components/KeyListener";
import { APP_SHORTCUTS } from "@lichtblick/suite-base/components/KeyboardShortcuts/appShortcuts";
import { useStyles } from "@lichtblick/suite-base/components/Panel.style";
import PanelContext from "@lichtblick/suite-base/components/PanelContext";
import PanelErrorBoundary from "@lichtblick/suite-base/components/PanelErrorBoundary";
import { MessagePathDropConfig } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import PanelLogs from "@lichtblick/suite-base/components/PanelLogs";
import { PanelOverlay, PanelOverlayProps } from "@lichtblick/suite-base/components/PanelOverlay";
import { PanelRoot } from "@lichtblick/suite-base/components/PanelRoot";
import {
  loadPanelLogsHeight,
  savePanelLogsHeight,
} from "@lichtblick/suite-base/components/helpers";
import {
  PanelContextType,
  PanelLog,
  PanelStatics,
  GenericPanelProps,
} from "@lichtblick/suite-base/components/types";
import {
  useCurrentLayoutActions,
  useSelectedPanels,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import {
  useWorkspaceStore,
  WorkspaceStoreSelectors,
} from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useInteractionCapture } from "@lichtblick/suite-base/hooks/useInteractionCapture";
import { usePanelDragHandle } from "@lichtblick/suite-base/hooks/usePanelDragHandle";
import { AppEvent } from "@lichtblick/suite-base/services/IAnalytics";
import { useMessagePathDrop } from "@lichtblick/suite-base/services/messagePathDragging";
import {
  clearPanelDrop,
  setPanelDropConfig,
} from "@lichtblick/suite-base/services/messagePathDragging/panelDropRegistry";
import { OpenSiblingPanel, PanelConfig, SaveConfig } from "@lichtblick/suite-base/types/panels";
import { shortcutKeyHandlers } from "@lichtblick/suite-base/util/keyboardShortcuts";
import { getPanelIdForType, getPanelTypeFromId } from "@lichtblick/suite-base/util/layout";
import { getSiblingGroup } from "@lichtblick/suite-base/util/layoutTree";
import { findLayoutTree } from "@lichtblick/suite-base/util/tabLayout";

const MAX_PANEL_LOGS = 1000;

/** Used in storybook when panels are renered outside of a <PanelLayout/> */
const FALLBACK_PANEL_ID = "$unknown_id";

/** Id suffix of the read-only copies of a panel that show the other compared recordings */
const COPY_ID_SUFFIX = "@compare-copy";

// Copies of a panel never change its config or take drops: the panel itself does
const ignoreSaveConfig = (): void => {};
const ignoreMessagePathDropConfig = (): void => {};

/** Clicks a panel already handled, so the panels around it (Tab panels) ignore them. */
const panelHandledClicks = new WeakSet<Event>();

/**
 * Wrap a panel in an error boundary and flex box, supplying its saved config and saveConfig.
 * Use `export default Panel(MyPanelComponent)`; stories and tests can override the saved config
 * with `<MyPanel config={…} />`.
 */
export default function Panel<
  Config extends PanelConfig,
  PanelProps extends { config: Config; saveConfig: SaveConfig<Config> },
>(
  PanelComponent: ComponentType<PanelProps> & PanelStatics<Config>,
): ComponentType<GenericPanelProps<Config> & Omit<PanelProps, "config" | "saveConfig">> &
  PanelStatics<Config> {
  /** Bind one panel instance to its saved configuration, controls, logs, and selection state. */
  function ConnectedPanel(props: GenericPanelProps<Config>) {
    const [logs, setLogs] = useState<PanelLog[]>([]);
    const [showLogs, setShowLogs] = useState(false);

    const addLog = useCallback((message: string, error?: Error) => {
      // Keep only the newest entries: an unbounded log copies an ever-growing array per append
      setLogs((prev) => [
        ...prev.slice(-(MAX_PANEL_LOGS - 1)),
        { timestamp: new Date().toLocaleString(), message, error },
      ]);
    }, []);
    const { childId = FALLBACK_PANEL_ID, overrideConfig, ...otherProps } = props;
    const { classes, cx, theme } = useStyles();
    const isMounted = useMountedState();

    const {
      selectedPanelIds,
      setSelectedPanelIds,
      selectAllPanels,
      togglePanelSelected,
      getSelectedPanelIds,
    } = useSelectedPanels();

    const isSelected = useMemo(
      () => selectedPanelIds.includes(childId),
      [childId, selectedPanelIds],
    );
    const numSelectedPanelsIfSelected = useMemo(
      () => (isSelected ? selectedPanelIds.length : 0),
      [isSelected, selectedPanelIds],
    );

    const {
      savePanelConfigs,
      updatePanelConfigs,
      groupPanels,
      closePanel,
      splitPanel,
      swapPanel,
      addPanel,
      getCurrentLayoutState,
    } = useCurrentLayoutActions();

    const [quickActionsKeyPressed, setQuickActionsKeyPressed] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [fullscreenSourceRect, setFullscreenSourceRect] = useState<DOMRect | undefined>(
      undefined,
    );
    const [hasFullscreenDescendant, _setHasFullscreenDescendant] = useState(false);
    const panelRootRef = useRef<HTMLDivElement>(null);
    const panelCatalog = usePanelCatalog();

    // There may be a parent panel (when a panel is in a tab).
    const parentPanelContext = useContext(PanelContext);

    const type = PanelComponent.panelType;
    const title = useMemo(
      () => panelCatalog.getPanelByType(type)?.title ?? "",
      [panelCatalog, type],
    );

    const defaultConfig = PanelComponent.defaultConfig;
    const [savedConfig, saveConfig] = useConfigById<Config>(childId);

    const resetPanel = useCallback(() => {
      saveConfig(defaultConfig);
    }, [defaultConfig, saveConfig]);

    // PanelSettings needs useConfigById to return a complete config. If there is no saved config
    // (or it is an empty object), or if keys have been added to the default config since it was
    // previously saved, we save the default config provided by the panel. This typically happens
    // when a new panel is added and the layout does not yet have a config. Even if this effect gets
    // run more than once, we only need to save the default config once.
    //
    // An empty object can occur when swapping a panel
    const savedDefaultConfig = useRef(false);
    useLayoutEffect(() => {
      if (savedDefaultConfig.current) {
        return;
      }

      const fillDefaults = (config: PanelConfig) => {
        savedDefaultConfig.current = true;
        savePanelConfigs({ configs: [{ id: childId, config }], fillsDefaults: true });
      };
      if (!savedConfig || Object.keys(savedConfig).length === 0) {
        fillDefaults(defaultConfig);
      } else if (
        Object.entries(defaultConfig).some(
          ([key, value]) => value != undefined && !(key in savedConfig),
        )
      ) {
        fillDefaults({ ...defaultConfig, ...savedConfig });
      }
    }, [childId, defaultConfig, savePanelConfigs, savedConfig]);

    const panelComponentConfig = useMemo(
      () => ({ ...defaultConfig, ...savedConfig, ...overrideConfig }),
      [savedConfig, defaultConfig, overrideConfig],
    );

    // Open a panel next to the current panel, of the specified `panelType`.
    // If such a panel already exists, we update it with the new props.
    const openSiblingPanel = useCallback<OpenSiblingPanel>(
      async ({ panelType, siblingConfigCreator, updateIfExists }) => {
        const panelsState = getCurrentLayoutState().selectedLayout?.data;
        if (!panelsState) {
          return;
        }

        let siblingDefaultConfig: PanelConfig = {};

        // If we can lookup the sibling panel type, try to load the default config from the panel module
        const siblingPanelInfo = panelCatalog.getPanelByType(panelType);
        if (siblingPanelInfo) {
          const siblingModule = await siblingPanelInfo.module();
          if (!isMounted()) {
            return;
          }

          siblingDefaultConfig = siblingModule.default.defaultConfig;
        }

        // Try to find a sibling panel and update it with the `siblingConfig`
        if (updateIfExists) {
          const sibling = getSiblingGroup(findLayoutTree(panelsState, childId)?.tree, childId);
          const siblingId = sibling?.active ?? sibling?.panels[0];
          if (siblingId != undefined && getPanelTypeFromId(siblingId) === panelType) {
            const siblingConfig: PanelConfig = {
              ...siblingDefaultConfig,
              ...panelsState.configById[siblingId],
            };
            savePanelConfigs({
              configs: [
                {
                  id: siblingId,
                  config: siblingConfigCreator(siblingConfig),
                  defaultConfig: siblingDefaultConfig,
                },
              ],
            });
            return;
          }
        }

        // Otherwise, open new panel
        addPanel({
          id: getPanelIdForType(panelType),
          config: { ...siblingDefaultConfig, ...siblingConfigCreator(siblingDefaultConfig) },
          position: "right",
          targetPanelId: childId,
        });
      },
      [addPanel, childId, getCurrentLayoutState, isMounted, panelCatalog, savePanelConfigs],
    );

    const replacePanel = useCallback(
      (newPanelType: string, config: Record<string, unknown>) => {
        swapPanel({ originalId: childId, type: newPanelType, config });
      },
      [childId, swapPanel],
    );

    const panelSettingsOpen = useWorkspaceStore(WorkspaceStoreSelectors.selectPanelSettingsOpen);

    const onPanelRootClick: MouseEventHandler<HTMLDivElement> = useCallback(
      (e) => {
        // A click on a panel inside a Tab panel bubbles up to the Tab panel; it belongs to the
        // innermost panel only. React bubbles through the panel tree (also from portals such as
        // the context menu), so the first panel to see a click takes it.
        if (panelHandledClicks.has(e.nativeEvent)) {
          return;
        }
        panelHandledClicks.add(e.nativeEvent);
        if (panelSettingsOpen) {
          // Allow clicking with no modifiers to select a panel (and deselect others) when panel settings are open
          setSelectedPanelIds([childId]);
        } else if (e.metaKey || e.shiftKey || isSelected) {
          togglePanelSelected(childId);
        }
      },
      [childId, togglePanelSelected, isSelected, setSelectedPanelIds, panelSettingsOpen],
    );

    const capturePanelInteraction = useInteractionCapture(AppEvent.PANEL_INTERACTION, {
      attribute: "data-telemetry-id",
      data: { type },
    });

    const groupSelectedPanels = useCallback(() => {
      groupPanels({ targetPanelId: childId, panelIds: getSelectedPanelIds() });
    }, [childId, getSelectedPanelIds, groupPanels]);

    const removePanel = useCallback(() => {
      closePanel({ id: childId });
    }, [childId, closePanel]);

    const split = useCallback(
      (id: string, direction: "row" | "column") => {
        const config = getCurrentLayoutState().selectedLayout?.data?.configById[id] ?? {};
        splitPanel({ id, direction, config });
      },
      [getCurrentLayoutState, splitPanel],
    );

    // Inside a dock layout, maximize the group so its tabs and content expand together.
    const dock = useContext(DockPanelContext);
    const subscribeDockMaximized = useCallback(
      (onChange: () => void) => {
        const sub = dock?.containerApi.onDidMaximizedGroupChange(onChange);
        return () => sub?.dispose();
      },
      [dock],
    );
    const dockMaximized = useSyncExternalStore(
      subscribeDockMaximized,
      () => dock?.api.isMaximized() ?? false,
    );

    const { enterFullscreen, exitFullscreen } = useMemo(
      () =>
        dock
          ? {
              enterFullscreen: () => {
                dock.api.maximize();
              },
              exitFullscreen: () => {
                dock.api.exitMaximized();
              },
            }
          : {
              enterFullscreen: () => {
                setFullscreenSourceRect(panelRootRef.current?.getBoundingClientRect());
                setFullscreen(true);

                // When entering fullscreen for a panel within a tab, we need to adjust the ancestor
                // tab(s)'s z-index to have our panel properly overlay other panels outside the tab.
                parentPanelContext?.setHasFullscreenDescendant(true);
              },
              exitFullscreen: () => {
                // Don't clear fullscreenSourceRect or hasFullscreenDescendant, they are needed during the exit transition
                setFullscreen(false);
              },
            },
      [dock, parentPanelContext],
    );
    const isFullscreen = dock ? dockMaximized : fullscreen;

    const setHasFullscreenDescendant = useCallback(
      // eslint-disable-next-line @lichtblick/no-boolean-parameters
      (value: boolean) => {
        _setHasFullscreenDescendant(value);
        parentPanelContext?.setHasFullscreenDescendant(value);
      },
      [parentPanelContext],
    );

    const {
      isDragging,
      isOver,
      isValidTarget,
      connectMessagePathDropTarget,
      dropMessage,
      setMessagePathDropConfig: setLocalMessagePathDropConfig,
      // Panels without a real id must not share an owner id, or they'd reject each other's drags.
    } = useMessagePathDrop(childId === FALLBACK_PANEL_ID ? undefined : childId);

    // Also register the drop config globally so the topic list can drop onto this panel on double-click
    const setMessagePathDropConfig = useCallback(
      (config: MessagePathDropConfig | undefined) => {
        setLocalMessagePathDropConfig(config);
        setPanelDropConfig(childId, config);
      },
      [childId, setLocalMessagePathDropConfig],
    );
    useEffect(
      () => () => {
        clearPanelDrop(childId);
      },
      [childId],
    );

    // We use two separate sets of key handlers because the panel context and exitFullScreen
    // change often and invalidate our key handlers during user interactions.
    const { keyUpHandlers, keyDownHandlers } = useMemo(
      () => ({
        keyUpHandlers: {
          Backquote: () => {
            setQuickActionsKeyPressed(false);
          },
          "~": () => {
            setQuickActionsKeyPressed(false);
          },
        },
        keyDownHandlers: {
          ...shortcutKeyHandlers(APP_SHORTCUTS, { "app.selectAllPanels": selectAllPanels }),
          Backquote: () => {
            setQuickActionsKeyPressed(true);
          },
          "~": () => {
            setQuickActionsKeyPressed(true);
          },
          Escape: () => {
            if (numSelectedPanelsIfSelected > 1) {
              setSelectedPanelIds([]);
            }
          },
        },
      }),
      [selectAllPanels, numSelectedPanelsIfSelected, setSelectedPanelIds],
    );

    const fullScreenKeyHandlers = useMemo(
      () => ({
        Escape: () => {
          exitFullscreen();
        },
      }),
      [exitFullscreen],
    );

    const panelRootCallbackRef = useCallback(
      (el: HTMLDivElement | null) => {
        panelRootRef.current = el;
        return connectMessagePathDropTarget(el);
      },
      [connectMessagePathDropTarget],
    );

    const otherPanelProps = useShallowMemo(otherProps);
    const childProps = useMemo(
      // We have to lie to TypeScript with "as PanelProps" because the "PanelProps extends {...}"
      // constraint technically allows the panel to require the types of config/saveConfig be more
      // specific types that aren't satisfied by the functions we pass in
      () =>
        ({
          config: panelComponentConfig,
          saveConfig,
          ...otherPanelProps,
        }) as PanelProps,
      [otherPanelProps, panelComponentConfig, saveConfig],
    );
    const child = useMemo(() => <PanelComponent {...childProps} />, [childProps]);

    // While recordings are compared: the panel shows one of them, or every one of them through
    // read-only copies of itself (see ComparedPanel)
    const compare = useCompare();
    const support = useMemo(
      () => compareSupport(type, panelComponentConfig),
      [panelComponentConfig, type],
    );
    const copy = useMemo(
      () => <PanelComponent {...childProps} saveConfig={ignoreSaveConfig} />,
      [childProps],
    );

    const renderCount = useRef(0);

    const perfInfo = useRef<HTMLDivElement>(null);
    const quickActionsOverlayRef = useRef<HTMLDivElement>(null);
    const onDragStart = useCallback(() => {
      // Temporarily hide the overlay so that the panel can be shown as the drag preview image --
      // even though the overlay is a sibling rather than a child, Chrome still includes it in the
      // preview if it is visible. Changing the appearance in the next React render cycle is not
      // enough; it actually needs to happen during the dragstart event.
      // https://bugs.chromium.org/p/chromium/issues/detail?id=1203107
      const overlay = quickActionsOverlayRef.current;
      if (overlay) {
        overlay.style.opacity = "0";
        setTimeout(() => (overlay.style.opacity = "1"), 0);
      }
    }, []);
    const connectDragHandle = usePanelDragHandle(onDragStart);

    const panelOverlayProps = useMemo(() => {
      const overlayProps: PanelOverlayProps = {
        open:
          isDragging || quickActionsKeyPressed || (isSelected && numSelectedPanelsIfSelected > 1),
        variant: undefined,
        highlightMode: undefined,
        actions: undefined,
        dropMessage,
      };

      if (isDragging && !isValidTarget) {
        overlayProps.variant = "invalidDropTarget";
      }
      if (isDragging && isOver) {
        overlayProps.variant = "validDropTarget";
      }
      if (isSelected && numSelectedPanelsIfSelected > 1) {
        overlayProps.onClickAway = () => {
          setSelectedPanelIds([]);
        };
        overlayProps.variant = "selected";
        overlayProps.highlightMode = "all";
        overlayProps.actions = [
          {
            key: "group",
            text: "Group as tabs",
            icon: <TabDesktop20Regular />,
            onClick: groupSelectedPanels,
          },
        ];
      }
      if (quickActionsKeyPressed) {
        overlayProps.variant = "selected";
        overlayProps.highlightMode = "active";
      }
      if (quickActionsKeyPressed) {
        overlayProps.actions = [
          {
            key: "splitDown",
            text: "Split down",
            icon: <SplitHorizontal20Regular />,
            onClick: () => {
              split(childId, "column");
            },
          },
          {
            key: "splitRight",
            text: "Split right",
            icon: <SplitVertical20Regular />,
            onClick: () => {
              split(childId, "row");
            },
          },
          {
            key: "remove",
            text: "Remove",
            icon: <Delete20Regular />,
            color: "error",
            onClick: removePanel,
          },
        ];
      }
      return overlayProps;
    }, [
      childId,
      dropMessage,
      groupSelectedPanels,
      isDragging,
      isOver,
      isSelected,
      isValidTarget,
      numSelectedPanelsIfSelected,
      quickActionsKeyPressed,
      removePanel,
      setSelectedPanelIds,
      split,
    ]);

    const panelContextValue: PanelContextType<PanelConfig> = {
      type,
      id: childId,
      title,
      config: panelComponentConfig,
      saveConfig: saveConfig as SaveConfig<PanelConfig>,
      updatePanelConfigs,
      openSiblingPanel,
      replacePanel,
      enterFullscreen,
      exitFullscreen,
      setHasFullscreenDescendant,
      isFullscreen,
      connectToolbarDragHandle: connectDragHandle,
      setMessagePathDropConfig,
      showLogs,
      setShowLogs: ({ show }) => {
        setShowLogs(show);
      },
      logError: addLog,
      logCount: logs.length,
    };
    const panelBody =
      compare && support.mode !== "none" ? (
        <ComparedPanel
          compare={compare}
          support={support}
          view={panelComponentConfig[COMPARE_VIEW_CONFIG_KEY] as CompareView | undefined}
          panel={child}
          copy={
            <PanelContext.Provider
              value={{
                ...panelContextValue,
                id: `${childId}${COPY_ID_SUFFIX}`,
                saveConfig: ignoreSaveConfig,
                setMessagePathDropConfig: ignoreMessagePathDropConfig,
                connectToolbarDragHandle: undefined,
              }}
            >
              {copy}
            </PanelContext.Provider>
          }
        />
      ) : (
        child
      );

    return (
      <Profiler
        id={childId}
        onRender={(_id, _phase, actualDuration, _baseDuration, _startTime, _commitTime) => {
          if (perfInfo.current) {
            perfInfo.current.innerText = `${++renderCount.current}\n${actualDuration.toFixed(1)}ms`;
          }
        }}
      >
        <PanelContext.Provider value={panelContextValue}>
          <KeyListener global keyUpHandlers={keyUpHandlers} keyDownHandlers={keyDownHandlers} />
          {isFullscreen && <KeyListener global keyDownHandlers={fullScreenKeyHandlers} />}
          <Transition
            in={fullscreen}
            onExited={() => {
              setHasFullscreenDescendant(false);
            }}
            nodeRef={panelRootRef}
            timeout={{
              // match to transition duration inside PanelRoot
              exit: theme.transitions.duration.shorter,
            }}
          >
            {(fullscreenState) => (
              <PanelRoot
                onClick={onPanelRootClick}
                onClickCapture={capturePanelInteraction}
                hasFullscreenDescendant={hasFullscreenDescendant}
                fullscreenState={fullscreenState}
                sourceRect={fullscreenSourceRect}
                selected={isSelected || (isDragging && isValidTarget && isOver)}
                data-testid={cx("panel-mouseenter-container", childId)}
                data-telemetry-id="panel"
                ref={panelRootCallbackRef}
              >
                {!isFullscreen && (
                  <PanelOverlay
                    {...panelOverlayProps}
                    ref={(el) => {
                      quickActionsOverlayRef.current = el;
                      return connectDragHandle?.(el);
                    }}
                  />
                )}

                <PanelErrorBoundary
                  onRemovePanel={removePanel}
                  onResetPanel={resetPanel}
                  onLogError={addLog}
                >
                  {panelBody}
                </PanelErrorBoundary>
                {process.env.NODE_ENV !== "production" && (
                  <div className={classes.perfInfo} ref={perfInfo} />
                )}

                {showLogs ? (
                  <PanelLogs
                    logs={logs}
                    initialHeight={loadPanelLogsHeight()}
                    onClose={() => {
                      setShowLogs(false);
                    }}
                    onClear={() => {
                      setLogs([]);
                    }}
                    onHeightChange={savePanelLogsHeight}
                  />
                ) : undefined}
              </PanelRoot>
            )}
          </Transition>
        </PanelContext.Provider>
      </Profiler>
    );
  }

  return Object.assign(React.memo(ConnectedPanel), {
    defaultConfig: PanelComponent.defaultConfig,
    panelType: PanelComponent.panelType,
    displayName: `Panel(${PanelComponent.displayName ?? PanelComponent.name})`,
  });
}
