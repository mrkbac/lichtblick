// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { Alert, Button, CssBaseline } from "@mui/material";
import {
  createContext,
  PropsWithChildren,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { TssCacheProvider } from "tss-react";

import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";

import { DockPanelContext } from "./DockPanelContext";
import Stack from "./Stack";

type DocumentPiP = {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>;
};
type WindowActions = {
  open: (mode: "popout" | "pip") => void;
  close: () => void;
  isOpen: boolean;
  supportsPiP: boolean;
};
export const PanelWindowContext = createContext<WindowActions | undefined>(undefined);

/** Copy global CSS; panel styles are inserted into this document by its own Emotion caches. */
function copyStyles(source: Document, target: Document) {
  for (const sheet of source.styleSheets) {
    try {
      const style = target.createElement("style");
      style.textContent = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
      target.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = target.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.head.appendChild(link);
      }
    }
  }
}

function PanelWindowStyles({ target, children }: PropsWithChildren<{ target: Window }>) {
  const caches = useMemo(
    () => ({
      mui: createCache({ key: "mui", prepend: true, container: target.document.head }),
      tss: createCache({ key: "tss", container: target.document.head }),
    }),
    [target],
  );
  return (
    <CacheProvider value={caches.mui}>
      <TssCacheProvider value={caches.tss}>
        <CssBaseline />
        {children}
      </TssCacheProvider>
    </CacheProvider>
  );
}

/** Keep the shared player/context, but recreate renderers rather than adopt a live canvas. */
export function PanelWindow({ children, title }: PropsWithChildren<{ title: string }>): ReactNode {
  const parent = useContext(PanelWindowContext);
  const { t } = useTranslation("panelToolbar");
  const [target, setTarget] = useState<Window>();
  const [failed, setFailed] = useState(false);
  const live = useRef(true);
  const pending = useRef(false);
  const windowRef = useRef<Window | undefined>(undefined);
  const pip = (window as Window & { documentPictureInPicture?: DocumentPiP })
    .documentPictureInPicture;

  useEffect(() => {
    const close = () => {
      windowRef.current?.close();
    };
    window.addEventListener("pagehide", close);
    live.current = true;
    return () => {
      live.current = false;
      window.removeEventListener("pagehide", close);
      close();
    };
  }, []);

  const actions = useMemo<WindowActions>(
    () => ({
      isOpen: target != undefined,
      supportsPiP: pip != undefined,
      close: () => {
        windowRef.current?.close();
      },
      open: (mode) => {
        if (pending.current || windowRef.current != undefined) {
          windowRef.current?.focus();
          return;
        }
        pending.current = true;
        setFailed(false);
        const open = async () => {
          const child =
            mode === "pip"
              ? await pip?.requestWindow({ width: 800, height: 600 })
              : window.open("about:blank", "_blank", "popup,width=1000,height=700");
          if (!child) {
            throw new Error("Panel window unavailable");
          }
          if (!live.current) {
            child.close();
            return;
          }
          windowRef.current = child;
          const doc = child.document;
          doc.title = title;
          doc.documentElement.lang = document.documentElement.lang;
          doc.documentElement.dataset.colorMode = document.documentElement.dataset.colorMode;
          const base = doc.createElement("base");
          base.href = document.baseURI;
          doc.head.appendChild(base);
          copyStyles(document, doc);
          doc.body.style.cssText = "margin:0;width:100vw;height:100vh;display:flex;overflow:hidden";
          const restore = () => {
            windowRef.current = undefined;
            if (live.current) {
              setTarget(undefined);
            }
          };
          child.addEventListener("pagehide", restore, { once: true });
          child.addEventListener("beforeunload", restore, { once: true });
          // Existing app-wide shortcuts live on the opener document. Preserve typing in the child.
          const key = (event: KeyboardEvent) => {
            const el = event.target as HTMLElement | null;
            if (
              el?.nodeType === 1 &&
              el.closest("input,textarea,[contenteditable=true],.monaco-editor")
            ) {
              return;
            }
            const forwarded = new KeyboardEvent(event.type, {
              key: event.key,
              code: event.code,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              shiftKey: event.shiftKey,
              altKey: event.altKey,
              repeat: event.repeat,
              cancelable: true,
            });
            document.dispatchEvent(forwarded);
            if (forwarded.defaultPrevented) {
              event.preventDefault();
            }
          };
          for (const type of ["keydown", "keyup", "keypress"] as const) {
            doc.addEventListener(type, key);
          }
          setTarget(child);
          child.focus();
        };
        void open()
          .catch(() => {
            windowRef.current?.close();
            if (live.current) {
              setFailed(true);
            }
          })
          .finally(() => {
            pending.current = false;
          });
      },
    }),
    [pip, target, title],
  );

  // A Tab panel can contain several panels; all of them share its one floating window.
  if (isDesktopApp() || parent?.isOpen === true) {
    return children;
  }
  return (
    <PanelWindowContext.Provider value={actions}>
      {target ? (
        <>
          <Stack alignItems="center" justifyContent="center" flex={1} gap={1}>
            <Button
              onClick={() => {
                target.focus();
              }}
            >
              {t("showPanelWindow")}
            </Button>
            <Button onClick={actions.close}>{t("returnToWorkspace")}</Button>
          </Stack>
          {createPortal(
            <PanelWindowStyles target={target}>
              <DockPanelContext.Provider value={undefined}>{children}</DockPanelContext.Provider>
            </PanelWindowStyles>,
            target.document.body,
          )}
        </>
      ) : (
        <>
          {failed && (
            <Alert
              severity="error"
              onClose={() => {
                setFailed(false);
              }}
            >
              {t("panelWindowFailed")}
            </Alert>
          )}
          {children}
        </>
      )}
    </PanelWindowContext.Provider>
  );
}
