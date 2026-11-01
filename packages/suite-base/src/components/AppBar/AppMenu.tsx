// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Menu, PaperProps } from "@mui/material";
import { useSnackbar } from "notistack";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useStyles } from "@lichtblick/suite-base/components/AppBar/AppMenu.style";
import { RecentSourceLabel } from "@lichtblick/suite-base/components/RecentSourceLabel";
import { LICHTBLICK_DOCUMENTATION_LINK } from "@lichtblick/suite-base/constants/documentation";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import {
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { useInstallPrompt } from "@lichtblick/suite-base/hooks/useInstallPrompt";
import { useInteractionCapture } from "@lichtblick/suite-base/hooks/useInteractionCapture";
import { useLayoutTransfer } from "@lichtblick/suite-base/hooks/useLayoutTransfer";
import { checkForServiceWorkerUpdate } from "@lichtblick/suite-base/hooks/useServiceWorkerUpdatePrompt";
import { AppEvent } from "@lichtblick/suite-base/services/IAnalytics";
import { formatKeyboardShortcut } from "@lichtblick/suite-base/util/formatKeyboardShortcut";

import { NestedMenuItem } from "./NestedMenuItem";
import { AppBarMenuItem, AppMenuProps } from "./types";

// Number of recent sources listed in the menu; the open dialog lists all of them
const MENU_RECENTS_COUNT = 5;

const selectLeftSidebarOpen = (store: WorkspaceContextStore) => store.sidebars.left.open;
const selectRightSidebarOpen = (store: WorkspaceContextStore) => store.sidebars.right.open;

export function AppMenu(props: AppMenuProps): React.JSX.Element {
  const { open, handleClose, anchorEl, anchorReference, anchorPosition, disablePortal } = props;
  const { classes } = useStyles();
  const { t } = useTranslation("appBar");
  const { enqueueSnackbar } = useSnackbar();

  const [nestedMenu, setNestedMenu] = useState<string | undefined>();
  const captureMenuClick = useInteractionCapture(AppEvent.APP_MENU_CLICK);

  const { recentSources, selectRecent, clearRecents } = usePlayerSelection();

  const leftSidebarOpen = useWorkspaceStore(selectLeftSidebarOpen);
  const rightSidebarOpen = useWorkspaceStore(selectRightSidebarOpen);
  const { sidebarActions, dialogActions } = useWorkspaceActions();

  const handleNestedMenuClose = useCallback(() => {
    setNestedMenu(undefined);
    handleClose();
  }, [handleClose]);

  const handleItemPointerEnter = useCallback((id: string) => {
    setNestedMenu(id);
  }, []);

  const { importLayout, exportLayout } = useLayoutTransfer();

  const runLayoutAction = useCallback(
    (action: () => Promise<unknown>) => {
      void (async () => {
        try {
          await action();
          handleNestedMenuClose();
        } catch (err: unknown) {
          console.error(err);
        }
      })();
    },
    [handleNestedMenuClose],
  );

  // FILE

  const fileItems = useMemo(() => {
    const items: AppBarMenuItem[] = [
      {
        type: "item",
        label: t("open"),
        key: "open",
        dataTestId: "menu-item-open",
        onClick: () => {
          dialogActions.dataSource.open("start");
          handleNestedMenuClose();
        },
      },
      {
        type: "item",
        label: t("openLocalFiles"),
        key: "open-file",
        shortcut: formatKeyboardShortcut("O", ["Meta"]),
        dataTestId: "menu-item-open-local-file",
        onClick: () => {
          handleNestedMenuClose();
          dialogActions.openFile.open().catch((err: unknown) => {
            console.error(err);
          });
        },
      },
      {
        type: "item",
        label: t("openConnection"),
        key: "open-connection",
        shortcut: formatKeyboardShortcut("O", ["Meta", "Shift"]),
        dataTestId: "menu-item-open-connection",
        onClick: () => {
          dialogActions.dataSource.open("connection");
          handleNestedMenuClose();
        },
      },
    ];

    if (recentSources.length === 0) {
      return items;
    }

    items.push(
      { type: "divider" },
      {
        type: "item",
        label: t("recentDataSources"),
        key: "recent-sources",
        disabled: true,
      },
    );
    for (const recent of recentSources.slice(0, MENU_RECENTS_COUNT)) {
      items.push({
        type: "item",
        key: recent.id,
        selected: recent.current,
        onClick: () => {
          selectRecent(recent.id);
          handleNestedMenuClose();
        },
        label: <RecentSourceLabel recent={recent} />,
      });
    }
    items.push(
      { type: "divider" },
      {
        type: "item",
        key: "all-recent-sources",
        label: t("allRecentDataSources"),
        onClick: () => {
          dialogActions.dataSource.open("start");
          handleNestedMenuClose();
        },
      },
      {
        type: "item",
        key: "clear-recent-sources",
        label: t("clearRecentDataSources"),
        disabled: recentSources.every((recent) => recent.pinned === true),
        onClick: () => {
          clearRecents();
          handleNestedMenuClose();
        },
      },
    );

    return items;
  }, [
    clearRecents,
    dialogActions.dataSource,
    dialogActions.openFile,
    handleNestedMenuClose,
    recentSources,
    selectRecent,
    t,
  ]);

  // VIEW

  const viewItems = useMemo<AppBarMenuItem[]>(
    () => [
      {
        type: "item",
        label: leftSidebarOpen ? t("hideLeftSidebar") : t("showLeftSidebar"),
        key: "left-sidebar",
        shortcut: "[",
        onClick: () => {
          sidebarActions.left.setOpen(!leftSidebarOpen);
          handleNestedMenuClose();
        },
      },
      {
        type: "item",
        label: rightSidebarOpen ? t("hideRightSidebar") : t("showRightSidebar"),
        key: "right-sidebar",
        shortcut: "]",
        onClick: () => {
          sidebarActions.right.setOpen(!rightSidebarOpen);
          handleNestedMenuClose();
        },
      },
      {
        type: "divider",
      },
      {
        type: "item",
        label: t("importLayoutFromFile"),
        key: "import-layout",
        onClick: () => {
          runLayoutAction(importLayout);
        },
      },
      {
        type: "item",
        label: t("exportLayoutToFile"),
        key: "export-layout",
        onClick: () => {
          runLayoutAction(exportLayout);
        },
      },
    ],
    [
      exportLayout,
      handleNestedMenuClose,
      importLayout,
      leftSidebarOpen,
      rightSidebarOpen,
      runLayoutAction,
      sidebarActions.left,
      sidebarActions.right,
      t,
    ],
  );

  // HELP

  const onAboutClick = useCallback(() => {
    dialogActions.preferences.open("about");
    handleNestedMenuClose();
  }, [dialogActions.preferences, handleNestedMenuClose]);

  const onDemoClick = useCallback(() => {
    dialogActions.dataSource.open("demo");
    handleNestedMenuClose();
  }, [dialogActions.dataSource, handleNestedMenuClose]);

  const onDocsClick = useCallback(() => {
    window.open(LICHTBLICK_DOCUMENTATION_LINK, "_blank", "noopener,noreferrer");
    handleNestedMenuClose();
  }, [handleNestedMenuClose]);

  const onCheckForUpdatesClick = useCallback(() => {
    handleNestedMenuClose();
    checkForServiceWorkerUpdate()
      .then((found) => {
        if (!found) {
          enqueueSnackbar(t("noUpdateAvailable"), { variant: "success" });
        }
      })
      .catch((error: unknown) => {
        console.error(error);
        enqueueSnackbar(t("updateCheckFailed"), { variant: "error" });
      });
  }, [enqueueSnackbar, handleNestedMenuClose, t]);

  // only the web build registers a service worker (not desktop or the dev server)
  const installApp = useInstallPrompt();
  const onInstallClick = useCallback(() => {
    handleNestedMenuClose();
    installApp?.();
  }, [handleNestedMenuClose, installApp]);

  const hasServiceWorker =
    (navigator.serviceWorker as ServiceWorkerContainer | undefined)?.controller != undefined;

  const helpItems = useMemo<AppBarMenuItem[]>(
    () => [
      { type: "item", key: "about", label: t("about"), onClick: onAboutClick },
      ...(hasServiceWorker
        ? [
            {
              type: "item" as const,
              key: "check-for-updates",
              label: t("checkForUpdates"),
              onClick: onCheckForUpdatesClick,
            },
          ]
        : []),
      ...(installApp
        ? [
            {
              type: "item" as const,
              key: "install-app",
              label: t("installApp"),
              onClick: onInstallClick,
            },
          ]
        : []),
      { type: "divider" },
      {
        type: "item",
        key: "docs",
        label: t("documentation"),
        onClick: onDocsClick,
      },
      { type: "divider" },
      {
        type: "item",
        key: "demo",
        label: t("exploreSampleData"),
        onClick: onDemoClick,
      },
    ],
    [
      hasServiceWorker,
      installApp,
      onAboutClick,
      onCheckForUpdatesClick,
      onDemoClick,
      onDocsClick,
      onInstallClick,
      t,
    ],
  );

  return (
    <>
      <Menu
        anchorEl={anchorEl}
        anchorReference={anchorReference}
        anchorPosition={anchorPosition}
        disablePortal={disablePortal}
        id="app-menu"
        onClickCapture={captureMenuClick}
        open={open}
        disableAutoFocusItem
        onClose={handleNestedMenuClose}
        slotProps={{
          list: {
            "aria-labelledby": "app-menu-button",
            dense: true,
            className: classes.menuList,
          },
          paper: {
            "data-tourid": "app-menu",
          } as Partial<PaperProps & { "data-tourid"?: string }>,
        }}
      >
        <NestedMenuItem
          onPointerEnter={handleItemPointerEnter}
          items={fileItems}
          open={nestedMenu === "app-menu-file"}
          id="app-menu-file"
        >
          {t("file")}
        </NestedMenuItem>
        <NestedMenuItem
          onPointerEnter={handleItemPointerEnter}
          items={viewItems}
          open={nestedMenu === "app-menu-view"}
          id="app-menu-view"
        >
          {t("view")}
        </NestedMenuItem>
        <NestedMenuItem
          onPointerEnter={handleItemPointerEnter}
          items={helpItems}
          open={nestedMenu === "app-menu-help"}
          id="app-menu-help"
        >
          {t("help")}
        </NestedMenuItem>
      </Menu>
    </>
  );
}
