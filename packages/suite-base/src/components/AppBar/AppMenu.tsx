// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Divider, ListSubheader, Menu, MenuItem, PaperProps } from "@mui/material";
import { useSnackbar } from "notistack";
import { ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useStyles } from "@lichtblick/suite-base/components/AppBar/AppMenu.style";
import { useCommandPaletteStore } from "@lichtblick/suite-base/components/CommandPalette/CommandPalette";
import { LAYOUT_SHORTCUTS } from "@lichtblick/suite-base/components/CommandPalette/layoutShortcuts";
import { useExportableFile } from "@lichtblick/suite-base/components/ExportRecordingDialog/exportRecording";
import { useTrimStore } from "@lichtblick/suite-base/components/ExportRecordingDialog/trimStore";
import { useKeyboardShortcutsStore } from "@lichtblick/suite-base/components/KeyboardShortcuts/KeyboardShortcuts";
import { APP_SHORTCUTS } from "@lichtblick/suite-base/components/KeyboardShortcuts/appShortcuts";
import { useLiveRecordingsDialog } from "@lichtblick/suite-base/components/LiveRecordingsDialog";
import { RecentSourceLabel } from "@lichtblick/suite-base/components/RecentSourceLabel";
import { LICHTBLICK_DOCUMENTATION_LINK } from "@lichtblick/suite-base/constants/documentation";
import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { useInstallPrompt } from "@lichtblick/suite-base/hooks/useInstallPrompt";
import { useInteractionCapture } from "@lichtblick/suite-base/hooks/useInteractionCapture";
import { useLayoutTransfer } from "@lichtblick/suite-base/hooks/useLayoutTransfer";
import { checkForServiceWorkerUpdate } from "@lichtblick/suite-base/hooks/useServiceWorkerUpdate";
import { AppEvent } from "@lichtblick/suite-base/services/IAnalytics";
import { shortcutLabel } from "@lichtblick/suite-base/util/keyboardShortcuts";

import { AppMenuProps } from "./types";

// Number of recent sources listed in the menu; the open dialog lists all of them
const MENU_RECENTS_COUNT = 5;

/** The app menu: one flat list, grouped by headings, so every action is one click away. */
export function AppMenu(props: AppMenuProps): React.JSX.Element {
  const { open, handleClose, anchorEl, anchorReference, anchorPosition, disablePortal } = props;
  const { classes } = useStyles();
  const { t } = useTranslation("appBar");
  const { enqueueSnackbar } = useSnackbar();
  const captureMenuClick = useInteractionCapture(AppEvent.APP_MENU_CLICK);

  const { recentSources, selectRecent } = usePlayerSelection();
  const exportableFile = useExportableFile();
  const openExport = useTrimStore((state) => state.openExport);
  const showLiveRecordings = useLiveRecordingsDialog((state) => state.show);
  const showCommandPalette = useCommandPaletteStore((state) => state.show);
  const showShortcuts = useKeyboardShortcutsStore((state) => state.show);
  const { dialogActions } = useWorkspaceActions();
  const { importLayout, exportLayout } = useLayoutTransfer();
  const installApp = useInstallPrompt();
  const { t: tCommands } = useTranslation("commandPalette");
  const layoutActions = useCurrentLayoutActions();

  // Only the web build registers a service worker (not desktop or the dev server). Check the
  // registration, not `controller`: a hard reload or the very first load runs uncontrolled.
  const [hasServiceWorker, setHasServiceWorker] = useState(false);
  useEffect(() => {
    (navigator.serviceWorker as ServiceWorkerContainer | undefined)
      ?.getRegistration()
      .then((registration) => {
        setHasServiceWorker(registration != undefined);
      })
      .catch(() => {});
  }, []);

  const checkForUpdates = () => {
    checkForServiceWorkerUpdate()
      .then((found) => {
        enqueueSnackbar(t(found ? "updateReady" : "noUpdateAvailable"), {
          variant: found ? "info" : "success",
          // only feedback that the manual check ran; the app bar button is the real signal
          autoHideDuration: 3000,
        });
      })
      .catch((error: unknown) => {
        console.error(error);
        enqueueSnackbar(t("updateCheckFailed"), { variant: "error" });
      });
  };

  /** A menu item that closes the menu, then runs its action. */
  const item = (
    key: string,
    label: ReactNode,
    run: () => unknown,
    extra: { shortcut?: string; disabled?: boolean; selected?: boolean } = {},
  ) => (
    <MenuItem
      key={key}
      className={classes.menuItem}
      data-testid={`menu-item-${key}`}
      disabled={extra.disabled}
      selected={extra.selected}
      onClick={() => {
        handleClose();
        Promise.resolve(run()).catch((err: unknown) => {
          console.error(err);
        });
      }}
    >
      {label}
      {extra.shortcut != undefined && <kbd>{extra.shortcut}</kbd>}
    </MenuItem>
  );

  const recents = recentSources.slice(0, MENU_RECENTS_COUNT);

  return (
    <Menu
      anchorEl={anchorEl}
      anchorReference={anchorReference}
      anchorPosition={anchorPosition}
      disablePortal={disablePortal}
      id="app-menu"
      onClickCapture={captureMenuClick}
      open={open}
      disableAutoFocusItem
      onClose={handleClose}
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
      {item("open", t("open"), () => {
        dialogActions.dataSource.open("start");
      })}
      {item(
        "open-local-file",
        t("openLocalFiles"),
        async () => {
          await dialogActions.openFile.open();
        },
        {
          shortcut: shortcutLabel(APP_SHORTCUTS, "app.openFile"),
        },
      )}
      {item("export-recording", t("exportRecording"), openExport, {
        disabled: !exportableFile,
      })}
      {item("live-recordings", t("liveRecordings"), showLiveRecordings)}

      {recents.length > 0 && (
        <ListSubheader className={classes.subheader}>{t("recentDataSources")}</ListSubheader>
      )}
      {recents.map((recent) =>
        item(
          `recent-${recent.id}`,
          <RecentSourceLabel recent={recent} />,
          () => {
            selectRecent(recent.id);
          },
          { selected: recent.current },
        ),
      )}

      <ListSubheader className={classes.subheader}>{t("layout")}</ListSubheader>
      {LAYOUT_SHORTCUTS.map((shortcut) =>
        item(
          shortcut.id,
          tCommands(shortcut.titleKey),
          () => {
            shortcut.run(layoutActions);
          },
          { shortcut: shortcut.shortcut() },
        ),
      )}
      {item("import-layout", t("importLayoutFromFile"), importLayout)}
      {item("export-layout", t("exportLayoutToFile"), exportLayout)}

      <Divider />
      {item("command-palette", t("commandPalette"), showCommandPalette, {
        shortcut: shortcutLabel(APP_SHORTCUTS, "app.commandPalette"),
      })}
      {item("keyboard-shortcuts", t("keyboardShortcuts"), showShortcuts, {
        shortcut: shortcutLabel(APP_SHORTCUTS, "app.showShortcuts"),
      })}
      {item("settings", t("settings"), () => {
        dialogActions.preferences.open();
      })}
      {item("extensions", t("extensions"), () => {
        dialogActions.preferences.open("extensions");
      })}

      <Divider />
      {item("demo", t("exploreSampleData"), () => {
        dialogActions.dataSource.open("demo");
      })}
      {item("docs", t("documentation"), () => {
        window.open(LICHTBLICK_DOCUMENTATION_LINK, "_blank", "noopener,noreferrer");
      })}
      {item("about", t("about"), () => {
        dialogActions.preferences.open("about");
      })}
      {hasServiceWorker && item("check-for-updates", t("checkForUpdates"), checkForUpdates)}
      {installApp && item("install-app", t("installApp"), installApp)}
    </Menu>
  );
}
