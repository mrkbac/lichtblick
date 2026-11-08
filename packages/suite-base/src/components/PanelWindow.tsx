// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import {
  Alert,
  Button,
  CssBaseline,
  ThemeProvider as MuiThemeProvider,
  useTheme,
} from "@mui/material";
import {
  createContext,
  PropsWithChildren,
  ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { TssCacheProvider } from "tss-react";

import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";

import { DockPanelContext } from "./DockPanelContext";
import { useMonitorSetup } from "./MonitorSetupContext";
import Stack from "./Stack";
import { WindowBounds } from "./monitorSetup";

type DocumentPiP = {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>;
};
type WindowActions = {
  open: (mode: "popout" | "pip", bounds?: WindowBounds, existing?: Window) => void;
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

/** Give portaled controls their own caches so new styles stay in the panel document. */
function PanelWindowStyles({ target, children }: PropsWithChildren<{ target: Window }>) {
  const outerTheme = useTheme();
  const theme = useMemo(
    () => ({
      ...outerTheme,
      components: {
        ...outerTheme.components,
        MuiModal: {
          ...outerTheme.components?.MuiModal,
          defaultProps: {
            ...outerTheme.components?.MuiModal?.defaultProps,
            container: target.document.body,
          },
        },
      },
    }),
    [outerTheme, target],
  );
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
        <MuiThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </MuiThemeProvider>
      </TssCacheProvider>
    </CacheProvider>
  );
}

/** Keep the shared player/context, but recreate renderers rather than adopt a live canvas. */
export function PanelWindow({ children, title }: PropsWithChildren<{ title: string }>): ReactNode {
  const setup = useMonitorSetup();
  const parent = useContext(PanelWindowContext);
  const dock = useContext(DockPanelContext);
  const [windowMode, setWindowMode] = useState<"popout" | "pip">("popout");
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

  // Keep the panel mounted for its portal while Dockview gives its space to the remaining panels.
  useLayoutEffect(() => {
    if (!target || windowMode !== "popout" || !dock) {
      return;
    }
    const originalGroup = dock.api.group;
    const originalIndex = originalGroup.panels.findIndex((panel) => panel.id === dock.api.id);
    const hide = () => {
      if (!dock.containerApi.getPanel(dock.api.id)) {
        return;
      }
      // A stacked sibling must stay visible, so give the detached panel its own hidden group.
      if (dock.api.group.panels.length > 1) {
        dock.api.moveTo({ group: dock.api.group, position: "right" });
      }
      if (dock.api.group.api.isVisible) {
        dock.api.group.api.setVisible(false);
      }
    };
    hide();
    const subscription = dock.containerApi.onDidLayoutChange(hide);
    return () => {
      subscription.dispose();
      if (!dock.containerApi.getPanel(dock.api.id)) {
        return;
      }
      dock.api.group.api.setVisible(true);
      if (
        dock.containerApi.getGroup(originalGroup.id) === originalGroup &&
        originalGroup !== dock.api.group
      ) {
        dock.api.moveTo({ group: originalGroup, position: "center", index: originalIndex });
        originalGroup.api.setVisible(true);
      }
    };
  }, [dock, windowMode, target]);

  const actions = useMemo<WindowActions>(
    () => ({
      isOpen: target != undefined,
      supportsPiP: pip != undefined,
      close: () => {
        windowRef.current?.close();
      },
      open: (mode, bounds, existing) => {
        if (pending.current || windowRef.current != undefined) {
          if (bounds && windowRef.current && windowMode === "popout") {
            windowRef.current.moveTo(bounds.left, bounds.top);
            windowRef.current.resizeTo(bounds.width, bounds.height);
          }
          windowRef.current?.focus();
          return;
        }
        pending.current = true;
        setWindowMode(mode);
        setFailed(false);
        const open = async () => {
          const child =
            mode === "pip"
              ? await pip?.requestWindow({ width: 800, height: 600 })
              : (existing ??
                window.open(
                  "about:blank",
                  "_blank",
                  bounds
                    ? `popup,left=${bounds.left},top=${bounds.top},width=${bounds.width},height=${bounds.height}`
                    : "popup,width=1000,height=700",
                ));
          if (!child) {
            throw new Error("Panel window unavailable");
          }
          if (!live.current) {
            child.close();
            return;
          }
          windowRef.current = child;
          if (bounds) {
            child.moveTo(bounds.left, bounds.top);
            child.resizeTo(bounds.width, bounds.height);
          }
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
              (el.isContentEditable ||
                el.closest("input,textarea,[contenteditable=true],.monaco-editor"))
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
            windowRef.current = undefined;
            if (live.current) {
              setFailed(true);
            }
          })
          .finally(() => {
            pending.current = false;
          });
      },
    }),
    [pip, target, title, windowMode],
  );

  const register = setup?.register;
  useEffect(() => {
    if (!register || !dock || parent?.isOpen === true || isDesktopApp()) {
      return;
    }
    return register(dock.api.id, {
      open: (bounds, existing) => {
        actions.open("popout", bounds, existing);
      },
      getWindow: () => (windowMode === "popout" ? windowRef.current : undefined),
    });
  }, [actions, dock, parent?.isOpen, register, windowMode]);

  // A Tab panel can contain several panels; all of them share its one floating window.
  if (isDesktopApp() || parent?.isOpen === true) {
    return children;
  }
  return (
    <PanelWindowContext.Provider value={actions}>
      {target ? (
        <>
          {windowMode === "pip" && (
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
          )}
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
