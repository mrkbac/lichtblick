// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect } from "react";

import { AppBar, AppBarProps, useWorkspaceActions } from "@lichtblick/suite-base";

import { NativeMenuBridge } from "../common/types";

const menuBridge = (global as { menuBridge?: NativeMenuBridge }).menuBridge;

/** The default app bar, plus the native menu's items wired to the matching workspace dialogs. */
export function DesktopAppBar(props: AppBarProps): React.JSX.Element {
  const { dialogActions } = useWorkspaceActions();

  useEffect(() => {
    if (!menuBridge) {
      return;
    }
    const unregister = [
      menuBridge.addIpcEventListener("open", () => {
        dialogActions.dataSource.open("start");
      }),
      menuBridge.addIpcEventListener("open-file", () => {
        void dialogActions.openFile.open().catch((err: unknown) => {
          console.error(err);
        });
      }),
      menuBridge.addIpcEventListener("open-demo", () => {
        dialogActions.dataSource.open("demo");
      }),
      menuBridge.addIpcEventListener("open-help-about", () => {
        dialogActions.preferences.open("about");
      }),
      menuBridge.addIpcEventListener("open-help-general", () => {
        dialogActions.preferences.open("general");
      }),
    ];
    return () => {
      unregister.forEach((fn) => {
        fn();
      });
    };
  }, [dialogActions]);

  return <AppBar {...props} />;
}
