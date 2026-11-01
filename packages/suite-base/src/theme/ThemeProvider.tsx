// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { ThemeProvider as MuiThemeProvider, darken } from "@mui/material";
import * as React from "react";
import { useEffect, useLayoutEffect, useMemo } from "react";

import { createMuiTheme } from "@lichtblick/theme";

// Make sure mui styles are loaded first so that our makeStyles customizations
// take precedence.
const muiCache = createCache({ key: "mui", prepend: true });

// By default the ThemeProvider adds an extra div to the DOM tree. We can disable this with a
// custom `as` component to FluentThemeProvider. The component must support a `ref` property
// otherwise we get react warnings.
const ThemeContainer = React.forwardRef((props: React.PropsWithChildren, _ref) => (
  <>{props.children}</>
));
ThemeContainer.displayName = "ThemeContainer";

export default function ThemeProvider({
  children,
  isDark,
}: React.PropsWithChildren<{ isDark: boolean }>): React.ReactElement | ReactNull {
  useEffect(() => {
    // Trick CodeEditor into sync with our theme
    document.documentElement.setAttribute("data-color-mode", isDark ? "dark" : "light");

    // remove styles set to prevent browser flash on init
    document.querySelector("#loading-styles")?.remove();
  }, [isDark]);

  const muiTheme = useMemo(() => createMuiTheme(isDark ? "dark" : "light"), [isDark]);

  useLayoutEffect(() => {
    // Match the app bar, which the installed PWA draws in the title bar next to the browser's
    // own controls. Update the existing tag: browsers only read the first theme-color meta.
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    const appBar = muiTheme.palette.appBar.main ?? "";
    // An open dialog's backdrop (black at 0.4, see MuiBackdrop) dims the app bar; dim the
    // title bar controls with it. Dialogs are portaled into <body>, so watching its children
    // is enough. Menus and popovers use invisible backdrops and leave the color alone.
    const dimmed = darken(appBar, 0.4);
    const update = () => {
      const backdrop = document.querySelector(".MuiBackdrop-root:not(.MuiBackdrop-invisible)");
      meta.content = backdrop ? dimmed : appBar;
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true });
    return () => {
      observer.disconnect();
    };
  }, [muiTheme]);

  return (
    <CacheProvider value={muiCache}>
      <MuiThemeProvider theme={muiTheme}>{children}</MuiThemeProvider>
    </CacheProvider>
  );
}
