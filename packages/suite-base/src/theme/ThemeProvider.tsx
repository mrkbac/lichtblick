// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { ThemeProvider as MuiThemeProvider, darken } from "@mui/material";
import * as React from "react";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo } from "react";
import { TssCacheProvider } from "tss-react";

import { createMuiTheme } from "@lichtblick/theme";

/** Carries document ownership across built-in panels with separate React roots. */
export const ThemeDocumentContext = createContext<Document | undefined>(undefined);

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
  ownerDocument: explicitDocument,
}: React.PropsWithChildren<{
  isDark: boolean;
  ownerDocument?: Document;
}>): React.ReactElement | null {
  const inheritedDocument = useContext(ThemeDocumentContext);
  const ownerDocument = explicitDocument ?? inheritedDocument ?? document;
  // Nested panel themes style their subtree; the outer theme owns document/PWA chrome.
  const ownsDocument = inheritedDocument !== ownerDocument;
  const windowCaches = useMemo(
    () =>
      ownerDocument === document
        ? undefined
        : {
            mui: createCache({ key: "mui", prepend: true, container: ownerDocument.head }),
            tss: createCache({ key: "tss", container: ownerDocument.head }),
          },
    [ownerDocument],
  );
  useEffect(() => {
    if (!ownsDocument) {
      return;
    }
    // Trick CodeEditor into sync with our theme
    ownerDocument.documentElement.setAttribute("data-color-mode", isDark ? "dark" : "light");

    // remove styles set to prevent browser flash on init
    ownerDocument.querySelector("#loading-styles")?.remove();
  }, [isDark, ownerDocument, ownsDocument]);

  const muiTheme = useMemo(() => createMuiTheme(isDark ? "dark" : "light"), [isDark]);

  useLayoutEffect(() => {
    if (!ownsDocument) {
      return;
    }
    // Match the app bar, which the installed PWA draws in the title bar next to the browser's
    // own controls. Update the existing tag: browsers only read the first theme-color meta.
    let meta = ownerDocument.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = ownerDocument.createElement("meta");
      meta.name = "theme-color";
      ownerDocument.head.appendChild(meta);
    }
    const appBar = muiTheme.palette.appBar.main ?? "";
    // A dialog's backdrop (black at 0.4, see MuiBackdrop) dims the app bar when it covers it; dim
    // the title bar controls with it. Only a backdrop reaching the top of the window counts: a
    // full-page dialog that starts below the app bar leaves the app bar, and so the title bar, as
    // is. Menus and popovers use invisible backdrops and leave the color alone.
    const dimmed = darken(appBar, 0.4);
    const update = () => {
      const backdrops = ownerDocument.querySelectorAll(
        ".MuiBackdrop-root:not(.MuiBackdrop-invisible)",
      );
      const covered = [...backdrops].some((el) => el.getBoundingClientRect().top <= 0);
      meta.content = covered ? dimmed : appBar;
    };
    update();
    // Dialogs open, close, and change size or place (e.g. a dialog switching between a popup
    // and a full page); re-check at most once a frame.
    let frame: number | undefined;
    const ownerWindow = ownerDocument.defaultView ?? window;
    const observer = new ownerWindow.MutationObserver(() => {
      frame ??= ownerWindow.requestAnimationFrame(() => {
        frame = undefined;
        update();
      });
    });
    observer.observe(ownerDocument.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => {
      observer.disconnect();
      if (frame != undefined) {
        ownerWindow.cancelAnimationFrame(frame);
      }
    };
  }, [muiTheme, ownerDocument, ownsDocument]);

  const content = (
    <CacheProvider value={windowCaches?.mui ?? muiCache}>
      <MuiThemeProvider theme={muiTheme}>{children}</MuiThemeProvider>
    </CacheProvider>
  );
  return (
    <ThemeDocumentContext.Provider value={ownerDocument}>
      {windowCaches ? (
        <TssCacheProvider value={windowCaches.tss}>{content}</TssCacheProvider>
      ) : (
        content
      )}
    </ThemeDocumentContext.Provider>
  );
}
