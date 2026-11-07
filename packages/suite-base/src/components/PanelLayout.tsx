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
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

import { DockPanelContext } from "@lichtblick/suite-base/components/DockPanelContext";
import { EmptyPanelLayout } from "@lichtblick/suite-base/components/EmptyPanelLayout";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { LayoutTabContext } from "@lichtblick/suite-base/components/LayoutTabContext";
import {
  getPanelDragData,
  isPanelDrag,
} from "@lichtblick/suite-base/components/PanelCatalog/panelDrag";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useAppContext } from "@lichtblick/suite-base/context/AppContext";
import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useExtensionCatalog } from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import { PanelCatalog, usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
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

import ErrorBoundary from "./ErrorBoundary";
import { useStyles } from "./PanelLayout.style";
import { PanelRemounter } from "./PanelRemounter";
import { NewTabDropTarget, PanelTab, getForeignPanelId } from "./PanelTab";
import { UnknownPanel } from "./UnknownPanel";
import { clearJunctionCursor, startSashDrag, updateJunctionCursor } from "./sashIntersection";
import "dockview-react/dist/styles/dockview.css";
import { useInstallingExtensionsStore } from "../hooks/useInstallingExtensionsStore";

type PanelComponents = ReadonlyMap<string, React.ComponentType<{ childId: string }>>;
const PanelComponentsContext = createContext<PanelComponents>(new Map());

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

/** Renders one panel inside its dockview group. */
function DockPanel({ api, containerApi }: IDockviewPanelProps): React.JSX.Element {
  const id = api.id;
  const type = getPanelTypeFromId(id);
  const panelComponents = useContext(PanelComponentsContext);
  const panelCatalog = usePanelCatalog();
  const customTitleSelector = useCallback(
    (state: LayoutState) => state.selectedLayout?.data?.configById[id]?.[PANEL_TITLE_CONFIG_KEY],
    [id],
  );
  const customTitle = useCurrentLayoutSelector(customTitleSelector);

  // The tab shows the panel's title when the panel shares its group with others.
  const title = panelTitle(id, customTitle, panelCatalog);
  useEffect(() => {
    api.setTitle(title);
  }, [api, title]);

  const dock = useMemo(() => ({ api, containerApi }), [api, containerApi]);
  const PanelComponent = panelComponents.get(type);
  return (
    <DockPanelContext.Provider value={dock}>
      <Suspense
        fallback={
          <EmptyState>
            <CircularProgress size={28} />
          </EmptyState>
        }
      >
        <PanelRemounter id={id}>
          {PanelComponent ? (
            <PanelComponent childId={id} />
          ) : (
            <UnknownPanel childId={id} overrideConfig={{ type, id }} />
          )}
        </PanelRemounter>
      </Suspense>
    </DockPanelContext.Provider>
  );
}

// Panels only depend on their dockview api, so a layout change elsewhere doesn't re-render them.
const DOCK_COMPONENTS = { [PANEL_COMPONENT]: React.memo(DockPanel) };

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
  /** The Tab panel this layout is a tab of; the root layout has none. */
  tabId?: string;
};

export function UnconnectedPanelLayout(props: Readonly<Props>): React.ReactElement {
  const { layout, onChange, loadingComponent, tabId } = props;
  const { addPanel, getCurrentLayoutState } = useCurrentLayoutActions();
  const panelCatalog = usePanelCatalog();
  const outerTabs = useContext(LayoutTabContext);
  const tabPath = useMemo(
    () => (tabId == undefined ? outerTabs : [...outerTabs, tabId]),
    [outerTabs, tabId],
  );
  const tabPathRef = useRef(tabPath);
  tabPathRef.current = tabPath;

  const panelComponents = useMemo<PanelComponents>(
    () =>
      new Map(
        panelCatalog.getPanels().map((panelInfo) => [panelInfo.type, React.lazy(panelInfo.module)]),
      ),
    [panelCatalog],
  );

  const apiRef = useRef<DockviewApi | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const dockviewRef = useRef<HTMLDivElement>(null);
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
      apiRef.current = api;
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
      // tab of a Tab panel before that layout sees them. Leave those to the inner layout.
      api.onWillShowOverlay((event) => {
        const target = event.nativeEvent.target;
        if (
          target instanceof Element &&
          target.closest("[data-panel-layout]") !== rootRef.current
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
    const element = dockviewRef.current;
    const api = apiRef.current;
    if (element && api) {
      return observeContainerSize(element, api);
    }
    return undefined;
  }, []);

  // Apply layout changes that did not come from dockview (adding a panel, undo, loading a layout).
  useEffect(() => {
    const api = apiRef.current;
    if (api != undefined && !layoutsEqual(layout, shownLayoutRef.current)) {
      showLayout(api, layout);
    }
  }, [layout, showLayout]);

  const onDidDrop = useCallback(
    (event: DockviewDidDropEvent) => {
      // Drops on a tab or the "+ New tab" target are handled there (PanelTab).
      if (
        !(event.nativeEvent instanceof DragEvent) ||
        (event.nativeEvent.target instanceof Element &&
          event.nativeEvent.target.closest(".dv-tab, [data-testid='new-tab-drop-target']"))
      ) {
        return;
      }
      const selection = getPanelDragData(event.nativeEvent.dataTransfer);
      const movedId = getForeignPanelId(event.api.id);
      if (selection == undefined && movedId == undefined) {
        return;
      }
      addPanel({
        id: selection ? getPanelIdForType(selection.type) : movedId!,
        config: selection?.config,
        position: event.position,
        // Without a group the panel was dropped on an edge of the whole layout.
        targetPanelId: event.group?.activePanel?.id,
        tabId,
      });
    },
    [addPanel, tabId],
  );

  return (
    <ErrorBoundary>
      {loadingComponent}
      <LayoutTabContext.Provider value={tabPath}>
        <PanelComponentsContext.Provider value={panelComponents}>
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
              ref={dockviewRef}
              disableAutoResizing
              components={DOCK_COMPONENTS}
              onReady={onReady}
              onDidDrop={onDidDrop}
              theme={DOCKVIEW_THEME}
              disableFloatingGroups
              singleTabMode="fullwidth"
              scrollbars="native"
              defaultTabComponent={PanelTab}
              leftHeaderActionsComponent={NewTabDropTarget}
              // Background tabs stay mounted and in the DOM, so switching tabs only toggles visibility.
              defaultRenderer="always"
            />
          </div>
        </PanelComponentsContext.Provider>
      </LayoutTabContext.Provider>
    </ErrorBoundary>
  );
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
  const { layoutEmptyState } = useAppContext();
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

  if (layoutEmptyState) {
    return layoutEmptyState;
  }

  return <></>;
}
