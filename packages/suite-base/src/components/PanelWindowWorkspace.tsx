// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { PanelLeft24Filled, PanelLeft24Regular } from "@fluentui/react-icons";
import { Typography } from "@mui/material";
import {
  PropsWithChildren,
  ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { createStore } from "zustand";

import { AppBarContainer } from "@lichtblick/suite-base/components/AppBar/AppBarContainer";
import { AppBarIconButton } from "@lichtblick/suite-base/components/AppBar/AppBarIconButton";
import PanelSettings from "@lichtblick/suite-base/components/PanelSettings";
import Sidebars from "@lichtblick/suite-base/components/Sidebars";
import { SidebarItem } from "@lichtblick/suite-base/components/Sidebars/types";
import Stack from "@lichtblick/suite-base/components/Stack";
import CurrentLayoutContext, {
  ICurrentLayout,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import {
  WorkspaceContext,
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { getAllPanelIds } from "@lichtblick/suite-base/util/tabLayout";

type Props = PropsWithChildren<{ target: Window; title: string; rootId?: string }>;
const selectLeft = (state: WorkspaceContextStore) => state.sidebars.left;
const EMPTY_ITEMS = new Map<string, SidebarItem>();

/** Give settings and selection a window-local home, while layout edits and player data stay shared. */
export function PanelWindowWorkspace(props: Props): ReactNode {
  const layout = useContext(CurrentLayoutContext);
  const workspace = useContext(WorkspaceContext);
  // Standalone panels in tests/stories need no workspace chrome.
  if (!layout || !workspace || props.rootId == undefined) {
    return props.children;
  }
  return <WindowWorkspace {...props} rootId={props.rootId} layout={layout} workspace={workspace} />;
}

function WindowWorkspace({
  children,
  rootId,
  target,
  title,
  layout,
  workspace,
}: Props & {
  rootId: string;
  layout: ICurrentLayout;
  workspace: NonNullable<React.ContextType<typeof WorkspaceContext>>;
}): React.JSX.Element {
  const [store] = useState(() =>
    createStore<WorkspaceContextStore>(() => ({
      ...workspace.getState(),
      sidebars: {
        left: {
          item: "panel-settings",
          open: false,
          size: 32_000 / Math.max(1, target.innerWidth),
        },
        right: { item: undefined, open: false, size: undefined },
      },
    })),
  );
  useLayoutEffect(() => {
    const fromParent = workspace.subscribe((state) => {
      store.setState({ ...state, sidebars: store.getState().sidebars });
    });
    const toParent = store.subscribe(
      ({ dialogs, featureTours, layoutBrowser, playbackControls }) => {
        const parent = workspace.getState();
        if (
          dialogs !== parent.dialogs ||
          featureTours !== parent.featureTours ||
          layoutBrowser !== parent.layoutBrowser ||
          playbackControls !== parent.playbackControls
        ) {
          workspace.setState({ dialogs, featureTours, layoutBrowser, playbackControls });
        }
      },
    );
    return () => {
      fromParent();
      toParent();
    };
  }, [store, workspace]);

  const [selection] = useState(() => {
    let ids: readonly string[] = [rootId];
    const listeners = new Set<(_: readonly string[]) => void>();
    const panelIds = () => {
      const data = layout.actions.getCurrentLayoutState().selectedLayout?.data;
      return data ? getAllPanelIds({ ...data, layout: { panels: [rootId] } }) : [];
    };
    return {
      getSelectedPanelIds: () => ids,
      setSelectedPanelIds: (
        value: readonly string[] | ((previous: readonly string[]) => readonly string[]),
      ) => {
        const allowed = new Set(panelIds());
        ids = (typeof value === "function" ? value(ids) : value).filter((id) => allowed.has(id));
        listeners.forEach((listener) => {
          listener(ids);
        });
      },
      addSelectedPanelIdsListener: (listener: (_: readonly string[]) => void) => {
        listeners.add(listener);
      },
      removeSelectedPanelIdsListener: (listener: (_: readonly string[]) => void) => {
        listeners.delete(listener);
      },
    };
  });
  const scopedLayout = useMemo(() => ({ ...layout, ...selection }), [layout, selection]);
  useLayoutEffect(() => {
    const data = layout.actions.getCurrentLayoutState().selectedLayout?.data;
    const moved = new Set(data ? getAllPanelIds({ ...data, layout: { panels: [rootId] } }) : []);
    layout.setSelectedPanelIds((ids) => ids.filter((id) => !moved.has(id)));
  }, [layout, rootId]);

  return (
    <CurrentLayoutContext.Provider value={scopedLayout}>
      <WorkspaceContext.Provider value={store}>
        <WindowContents title={title}>{children}</WindowContents>
      </WorkspaceContext.Provider>
    </CurrentLayoutContext.Provider>
  );
}

/** Reuse the normal resizable settings sidebar and title-bar styling, without the main window's right sidebar. */
function WindowContents({
  title,
  children,
}: PropsWithChildren<{ title: string }>): React.JSX.Element {
  const { t } = useTranslation("appBar");
  const { t: tWorkspace } = useTranslation("workspace");
  const left = useWorkspaceStore(selectLeft);
  const { sidebarActions } = useWorkspaceActions();
  const items = useMemo(
    () =>
      new Map<string, SidebarItem>([
        ["panel-settings", { title: tWorkspace("panel"), component: PanelSettings }],
      ]),
    [tWorkspace],
  );
  return (
    <>
      <AppBarContainer>
        <Stack direction="row" alignItems="center">
          <AppBarIconButton
            title={left.open ? t("hideLeftSidebar") : t("showLeftSidebar")}
            aria-label={left.open ? t("hideLeftSidebar") : t("showLeftSidebar")}
            data-testid="window-left-sidebar-button"
            onClick={() => {
              sidebarActions.left.setOpen(!left.open);
            }}
          >
            {left.open ? <PanelLeft24Filled /> : <PanelLeft24Regular />}
          </AppBarIconButton>
          <Typography variant="body2">{title}</Typography>
        </Stack>
      </AppBarContainer>
      <Sidebars
        items={EMPTY_ITEMS}
        bottomItems={EMPTY_ITEMS}
        selectedKey={undefined}
        onSelectKey={() => {}}
        leftItems={items}
        selectedLeftKey={left.open ? "panel-settings" : undefined}
        onSelectLeftKey={(key) => {
          sidebarActions.left.setOpen(key != undefined);
        }}
        leftSidebarSize={left.size}
        setLeftSidebarSize={sidebarActions.left.setSize}
        rightItems={EMPTY_ITEMS}
        selectedRightKey={undefined}
        onSelectRightKey={() => {}}
        rightSidebarSize={undefined}
        setRightSidebarSize={() => {}}
      >
        {children}
      </Sidebars>
    </>
  );
}
