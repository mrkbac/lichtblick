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

import { CircularProgress } from "@mui/material";
import {
  DockviewApi,
  DockviewDidDropEvent,
  DockviewReact,
  DockviewTheme,
  IDockviewPanelProps,
} from "dockview-react";
import React, {
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import {
  DockPanelContext,
  PanelVisibleContext,
} from "@lichtblick/suite-base/components/DockPanelContext";
import { EmptyPanelLayout } from "@lichtblick/suite-base/components/EmptyPanelLayout";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { LayoutTabContext } from "@lichtblick/suite-base/components/LayoutTabContext";
import {
  getPanelDragData,
  isPanelDrag,
} from "@lichtblick/suite-base/components/PanelCatalog/panelDrag";
import PanelContext from "@lichtblick/suite-base/components/PanelContext";
import {
  PanelHost,
  PanelHostContext,
  PanelSlot,
} from "@lichtblick/suite-base/components/PanelHostContext";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useExtensionCatalog } from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import {
  PanelCatalog,
  PanelInfo,
  usePanelCatalog,
} from "@lichtblick/suite-base/context/PanelCatalogContext";
import { LayoutNode } from "@lichtblick/suite-base/types/layouts";
import {
  PANEL_COMPONENT,
  dockviewToLayout,
  layoutToDockview,
} from "@lichtblick/suite-base/util/dockviewLayout";
import {
  PANEL_TITLE_CONFIG_KEY,
  getPanelIdForType,
  getPanelTypeFromId,
} from "@lichtblick/suite-base/util/layout";
import { layoutsEqual } from "@lichtblick/suite-base/util/layoutTree";
import { observeContainerSize } from "@lichtblick/suite-base/util/observeContainerSize";
import { getAllPanelIds } from "@lichtblick/suite-base/util/tabLayout";

import ErrorBoundary from "./ErrorBoundary";
import { useStyles } from "./PanelLayout.style";
import { PanelRemounter } from "./PanelRemounter";
import { getForeignPanelId } from "./PanelTab";
import { PanelWindow, PanelWindowContext } from "./PanelWindow";
import { UnknownPanel } from "./UnknownPanel";
import { clearJunctionCursor, startSashDrag, updateJunctionCursor } from "./sashIntersection";
import "dockview-react/dist/styles/dockview.css";
import { useInstallingExtensionsStore } from "../hooks/useInstallingExtensionsStore";

type PanelComponents = ReadonlyMap<string, React.ComponentType<{ childId: string }>>;

/**
 * One lazy component per panel module, so a remounted panel tree (e.g. for a new player session)
 * renders loaded panels right away. A new React.lazy suspends once even for a loaded module, and
 * React retries a suspended tree at a priority that steady live updates can starve.
 */
const lazyPanels = new WeakMap<PanelInfo["module"], React.ComponentType<{ childId: string }>>();
function lazyPanel(module: PanelInfo["module"]): React.ComponentType<{ childId: string }> {
  let component = lazyPanels.get(module);
  if (component == undefined) {
    component = React.lazy(module);
    lazyPanels.set(module, component);
  }
  return component;
}

const DOCKVIEW_THEME: DockviewTheme = {
  name: "lichtblick",
  className: "dockview-theme-lichtblick",
  gap: 0,
};

/** The tab title of a panel: its custom title, else the title of its panel type. */
function panelTitle(panelId: string, customTitle: unknown, panelCatalog: PanelCatalog): string {
  if (typeof customTitle === "string" && customTitle !== "") {
    return customTitle;
  }
  const type = getPanelTypeFromId(panelId);
  return panelCatalog.getPanelByType(type)?.title ?? type;
}

/** How long a panel no layout shows keeps running, so moving it to another layout keeps it. */
const HOST_GRACE_MS = 3000;

type HostEntry = {
  element: HTMLDivElement;
  slot: PanelSlot;
  /** The dockview panel showing it; none while it moves between layouts. */
  owner: object | undefined;
  timer?: ReturnType<typeof setTimeout>;
};

const allPanelIdsSelector = (state: LayoutState) => {
  const data = state.selectedLayout?.data;
  return data ? getAllPanelIds(data).join("\n") : "";
};

/**
 * Renders the panels of one window outside of any dockview, and moves each panel's element into
 * the dockview panel that shows it. Dockview remounts content that changes dockview (e.g. into a
 * Tab panel, which has a dockview of its own); this keeps the panel and its state instead.
 */
function PanelHostProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const panelCatalog = usePanelCatalog();
  const panelComponents = useMemo<PanelComponents>(
    () =>
      new Map(
        panelCatalog.getPanels().map((panelInfo) => [panelInfo.type, lazyPanel(panelInfo.module)]),
      ),
    [panelCatalog],
  );
  const [entries] = useState(() => new Map<string, HostEntry>());
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const panelIds = useCurrentLayoutSelector(allPanelIdsSelector);
  const panelIdsRef = useRef(new Set<string>());
  panelIdsRef.current = useMemo(() => new Set(panelIds.split("\n")), [panelIds]);

  const drop = useCallback(
    (panelId: string) => {
      const entry = entries.get(panelId);
      if (entry != undefined && entry.owner == undefined) {
        clearTimeout(entry.timer);
        entries.delete(panelId);
        rerender();
      }
    },
    [entries],
  );

  const host = useMemo<PanelHost>(
    () => ({
      claim: (panelId, owner, slot) => {
        let entry = entries.get(panelId);
        if (entry == undefined) {
          const element = document.createElement("div");
          element.style.cssText = "display: flex; width: 100%; height: 100%;";
          entry = { element, slot, owner };
          entries.set(panelId, entry);
        }
        clearTimeout(entry.timer);
        entry.owner = owner;
        entry.slot = slot;
        rerender();
        return entry.element;
      },
      release: (panelId, owner) => {
        const entry = entries.get(panelId);
        if (entry?.owner !== owner) {
          return;
        }
        entry.owner = undefined;
        if (panelIdsRef.current.has(panelId)) {
          entry.timer = setTimeout(() => {
            drop(panelId);
          }, HOST_GRACE_MS);
        } else {
          drop(panelId);
        }
      },
    }),
    [drop, entries],
  );

  // A removed panel goes right away instead of running on with its config gone.
  useEffect(() => {
    for (const [panelId, entry] of entries) {
      if (entry.owner == undefined && !panelIdsRef.current.has(panelId)) {
        drop(panelId);
      }
    }
  }, [drop, entries, panelIds]);

  useEffect(
    () => () => {
      for (const entry of entries.values()) {
        clearTimeout(entry.timer);
      }
    },
    [entries],
  );

  return (
    <PanelHostContext.Provider value={host}>
      {children}
      {[...entries].map(([panelId, entry]) =>
        createPortal(
          <HostedPanel
            id={panelId}
            slot={entry.slot}
            PanelComponent={panelComponents.get(getPanelTypeFromId(panelId))}
          />,
          entry.element,
          panelId,
        ),
      )}
    </PanelHostContext.Provider>
  );
}

/** One panel, with what it would get from the layout it is shown in. */
const HostedPanel = React.memo(function HostedPanel({
  id,
  slot,
  PanelComponent,
}: {
  id: string;
  slot: PanelSlot;
  PanelComponent: React.ComponentType<{ childId: string }> | undefined;
}): React.JSX.Element {
  const type = getPanelTypeFromId(id);
  const panelCatalog = usePanelCatalog();
  const customTitleSelector = useCallback(
    (state: LayoutState) => state.selectedLayout?.data?.configById[id]?.[PANEL_TITLE_CONFIG_KEY],
    [id],
  );
  const customTitle = useCurrentLayoutSelector(customTitleSelector);

  // The tab shows the panel's title when the panel shares its group with others.
  const title = panelTitle(id, customTitle, panelCatalog);
  const { api } = slot.dock;
  useEffect(() => {
    api.setTitle(title);
  }, [api, title]);

  // dockview hides a panel when another tab of its group is selected or another group is maximized.
  const subscribeDockVisible = useCallback(
    (onChange: () => void) => {
      const sub = api.onDidVisibilityChange(onChange);
      return () => {
        sub.dispose();
      };
    },
    [api],
  );
  const dockVisible = useSyncExternalStore(subscribeDockVisible, () => api.isVisible);

  return (
    <ErrorBoundary>
      <LayoutTabContext.Provider value={slot.tabPath}>
        <PanelContext.Provider value={slot.parentPanel}>
          <PanelWindowContext.Provider value={slot.parentWindow}>
            <DockPanelContext.Provider value={slot.dock}>
              <PanelVisibleContext.Provider value={slot.layoutVisible && dockVisible}>
                <Suspense
                  fallback={
                    <EmptyState>
                      <CircularProgress size={28} />
                    </EmptyState>
                  }
                >
                  <PanelWindow title={title}>
                    <PanelRemounter id={id}>
                      {PanelComponent ? (
                        <PanelComponent childId={id} />
                      ) : (
                        <UnknownPanel childId={id} overrideConfig={{ type, id }} />
                      )}
                    </PanelRemounter>
                  </PanelWindow>
                </Suspense>
              </PanelVisibleContext.Provider>
            </DockPanelContext.Provider>
          </PanelWindowContext.Provider>
        </PanelContext.Provider>
      </LayoutTabContext.Provider>
    </ErrorBoundary>
  );
});

/** Shows a panel in its dockview group; the panel itself is rendered by the PanelHost. */
function DockPanel({ api, containerApi }: IDockviewPanelProps): React.JSX.Element {
  const host = useContext(PanelHostContext);
  const tabPath = useContext(LayoutTabContext);
  const parentPanel = useContext(PanelContext);
  const parentWindow = useContext(PanelWindowContext);
  const layoutVisible = useContext(PanelVisibleContext);
  const slot = useMemo<PanelSlot>(
    () => ({ dock: { api, containerApi }, tabPath, parentPanel, parentWindow, layoutVisible }),
    [api, containerApi, tabPath, parentPanel, parentWindow, layoutVisible],
  );
  const holderRef = useRef<HTMLDivElement>(null);
  const [owner] = useState(() => ({}));

  useLayoutEffect(() => {
    const holder = holderRef.current;
    if (host == undefined || holder == undefined) {
      return undefined;
    }
    const element = host.claim(api.id, owner, slot);
    // Moving it again would restart iframes and drop focus.
    if (element.parentElement !== holder) {
      holder.appendChild(element);
    }
    return () => {
      host.release(api.id, owner);
    };
  }, [api.id, host, owner, slot]);

  return <div ref={holderRef} style={{ display: "contents" }} />;
}

// Panels only depend on their dockview api, so a layout change elsewhere doesn't re-render them.
const DOCK_COMPONENTS = { [PANEL_COMPONENT]: React.memo(DockPanel) };

/** Width of the band along a Tab panel's edges where a drop splits beside the whole Tab panel. */
const EDGE_BAND_PX = 24;

/** Whether the pointer is within the band along the edge of `element` that `position` names. */
function isInEdgeBand(element: HTMLElement | undefined, position: string, event: Event): boolean {
  if (element == undefined || !(event instanceof MouseEvent)) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  switch (position) {
    case "left":
      return event.clientX - rect.left <= EDGE_BAND_PX;
    case "right":
      return rect.right - event.clientX <= EDGE_BAND_PX;
    case "top":
      return event.clientY - rect.top <= EDGE_BAND_PX;
    case "bottom":
      return rect.bottom - event.clientY <= EDGE_BAND_PX;
    default:
      return false;
  }
}

/** A group shows its tab strip only when it stacks several panels. */
function updateGroupHeaders(api: DockviewApi) {
  for (const group of api.groups) {
    group.header.hidden = group.panels.length <= 1;
  }
}

type Props = {
  layout?: LayoutNode;
  onChange: (layout: LayoutNode | undefined) => void;
  loadingComponent?: React.JSX.Element;
  /** The Tab (or Stack) panel this layout is a tab of; the root layout has none. */
  tabId?: string;
  /** Which tab of `tabId` this layout is; the shown one when not given. */
  tabIndex?: number;
};

/** Synchronize a root or nested Dockview layout and resize each mounted container before paint. */
export function UnconnectedPanelLayout(props: Readonly<Props>): React.ReactElement {
  const { layout, onChange, loadingComponent, tabId, tabIndex } = props;
  const { addPanel, getCurrentLayoutState } = useCurrentLayoutActions();
  const panelCatalog = usePanelCatalog();
  const outerTabs = useContext(LayoutTabContext);
  const hasHost = useContext(PanelHostContext) != undefined;
  const tabPath = useMemo(
    () => (tabId == undefined ? outerTabs : [...outerTabs, tabId]),
    [outerTabs, tabId],
  );
  const tabPathRef = useRef(tabPath);
  tabPathRef.current = tabPath;

  const [dockviewApi, setDockviewApi] = useState<DockviewApi>();
  const rootRef = useRef<HTMLDivElement>(null);
  const [dockviewElement, setDockviewElement] = useState<HTMLDivElement | null>(null);
  // The layout dockview currently shows, to tell our own changes from the user's.
  const shownLayoutRef = useRef<LayoutNode | undefined>(undefined);
  const latestRef = useRef({ layout, onChange });
  latestRef.current = { layout, onChange };

  // Split sizes applied while the container has no size are lost, so apply them again once it has.
  const reapplyWhenSizedRef = useRef(false);

  const showLayout = useCallback(
    (api: DockviewApi, newLayout: LayoutNode | undefined) => {
      shownLayoutRef.current = newLayout;
      reapplyWhenSizedRef.current = api.width === 0 || api.height === 0;
      if (newLayout == undefined) {
        api.clear();
      } else {
        // Panels that stay in the layout keep running instead of remounting.
        const configById = getCurrentLayoutState().selectedLayout?.data?.configById;
        const titleOf = (id: string) =>
          panelTitle(id, configById?.[id]?.[PANEL_TITLE_CONFIG_KEY], panelCatalog);
        api.fromJSON(layoutToDockview(newLayout, titleOf), { reuseExistingPanels: true });
      }
      updateGroupHeaders(api);
    },
    [getCurrentLayoutState, panelCatalog],
  );

  const onReady = useCallback(
    ({ api }: { api: DockviewApi }) => {
      setDockviewApi(api);
      showLayout(api, latestRef.current.layout);

      api.onDidLayoutChange(() => {
        updateGroupHeaders(api);
        // Without a size (hidden, or not laid out yet) dockview reports meaningless split sizes.
        if (api.width === 0 || api.height === 0) {
          return;
        }
        if (reapplyWhenSizedRef.current) {
          showLayout(api, shownLayoutRef.current);
          return;
        }
        const newLayout = dockviewToLayout(api.toJSON());
        if (!layoutsEqual(newLayout, shownLayoutRef.current)) {
          shownLayoutRef.current = newLayout;
          latestRef.current.onChange(newLayout);
        }
      });

      // Dockview handles drags in the capture phase, so it would claim drags over the layout in a
      // tab of a Tab panel, and over its tab strip, before they see them. Leave those to them,
      // except in a band along the edges of the Tab panel: dropping there splits beside it.
      api.onWillShowOverlay((event) => {
        const target = event.nativeEvent.target;
        // A panel's own drop target (e.g. the Stack panel's drop bar) takes drops even at its edges.
        if (target instanceof Element && target.closest("[data-drop-target]") != undefined) {
          event.preventDefault();
          return;
        }
        if (
          target instanceof Element &&
          (target.closest("[data-panel-layout]") !== rootRef.current ||
            target.closest("[data-tab-strip]") != undefined) &&
          !isInEdgeBand(event.group?.element, event.position, event.nativeEvent)
        ) {
          event.preventDefault();
        }
      });

      // Accept panels dragged out of the panel catalog, and panels moved here from another layout
      // (between the root and a tab of a Tab panel) unless it's a Tab panel holding this layout.
      api.onUnhandledDragOver((event) => {
        if (!(event.nativeEvent instanceof DragEvent)) {
          return;
        }
        const foreignPanelId = getForeignPanelId(api.id);
        if (
          isPanelDrag(event.nativeEvent.dataTransfer) ||
          (foreignPanelId != undefined && !tabPathRef.current.includes(foreignPanelId))
        ) {
          event.accept();
        }
      });
    },
    [showLayout],
  );

  useEffect(() => {
    if (dockviewElement && dockviewApi) {
      return observeContainerSize(dockviewElement, dockviewApi);
    }
    return undefined;
  }, [dockviewElement, dockviewApi]);

  // Apply layout changes that did not come from dockview (adding a panel, undo, loading a layout).
  useEffect(() => {
    if (dockviewApi != undefined && !layoutsEqual(layout, shownLayoutRef.current)) {
      showLayout(dockviewApi, layout);
    }
  }, [layout, showLayout, dockviewApi]);

  const onDidDrop = useCallback(
    (event: DockviewDidDropEvent) => {
      if (!(event.nativeEvent instanceof DragEvent)) {
        return;
      }
      const selection = getPanelDragData(event.nativeEvent.dataTransfer);
      const id = selection ? getPanelIdForType(selection.type) : getForeignPanelId(event.api.id);
      if (id == undefined) {
        return;
      }
      addPanel({
        id,
        config: selection?.config,
        position: event.position,
        // Without a group the panel was dropped on an edge of the whole layout.
        targetPanelId: event.group?.activePanel?.id,
        tabId,
        tabIndex,
      });
    },
    [addPanel, tabId, tabIndex],
  );

  const content = (
    <ErrorBoundary>
      {loadingComponent}
      <LayoutTabContext.Provider value={tabPath}>
        {layout == undefined && <EmptyPanelLayout />}
        <div
          ref={rootRef}
          data-panel-layout
          style={{ display: layout == undefined ? "none" : "contents" }}
          onPointerDownCapture={(event) => {
            startSashDrag(event.nativeEvent);
          }}
          onPointerMove={(event) => {
            updateJunctionCursor(event.nativeEvent);
          }}
          onPointerOut={(event) => {
            clearJunctionCursor(event.nativeEvent);
          }}
        >
          <DockviewReact
            ref={setDockviewElement}
            disableAutoResizing
            components={DOCK_COMPONENTS}
            onReady={onReady}
            onDidDrop={onDidDrop}
            theme={DOCKVIEW_THEME}
            disableFloatingGroups
            singleTabMode="fullwidth"
            scrollbars="native"
            // Render in the group's slot so content follows resizing without a deferred overlay.
            defaultRenderer="onlyWhenVisible"
          />
        </div>
      </LayoutTabContext.Provider>
    </ErrorBoundary>
  );
  // Layouts nested in Tab panels share the host of the root layout.
  return hasHost ? content : <PanelHostProvider>{content}</PanelHostProvider>;
}

function ExtensionsLoadingState(): React.JSX.Element {
  return (
    <EmptyState>
      <Stack gap={1} alignItems="center">
        <CircularProgress size={28} />
        <span>Loading extensions…</span>
      </Stack>
    </EmptyState>
  );
}

const selectedLayoutExistsSelector = (state: LayoutState) =>
  state.selectedLayout?.data != undefined;
const selectedLayoutTreeSelector = (state: LayoutState) => state.selectedLayout?.data?.layout;

export default function PanelLayout(): React.JSX.Element {
  const { classes } = useStyles();
  const { changePanelLayout } = useCurrentLayoutActions();
  const layoutExists = useCurrentLayoutSelector(selectedLayoutExistsSelector);
  const layout = useCurrentLayoutSelector(selectedLayoutTreeSelector);
  const registeredExtensions = useExtensionCatalog((state) => state.installedExtensions);
  const { installingProgress } = useInstallingExtensionsStore();

  const isInstallingExtensions = installingProgress.inProgress;

  const onChange = useCallback(
    (newLayout: LayoutNode | undefined) => {
      changePanelLayout({ layout: newLayout });
    },
    [changePanelLayout],
  );

  if (registeredExtensions == undefined) {
    return <ExtensionsLoadingState />;
  }
  const loadingComponent = isInstallingExtensions ? (
    <Stack className={classes.overlayStyle}>
      <ExtensionsLoadingState />
    </Stack>
  ) : (
    <></>
  );

  if (layoutExists) {
    return (
      <UnconnectedPanelLayout
        layout={layout}
        onChange={onChange}
        loadingComponent={loadingComponent}
      />
    );
  }

  return <></>;
}
