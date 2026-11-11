// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

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

import AppCssBaseline from "@lichtblick/suite-base/components/CssBaseline";
import CurrentLayoutContext, {
  LayoutState,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";
import { getAllPanelIds } from "@lichtblick/suite-base/util/tabLayout";

import { DockPanelContext } from "./DockPanelContext";
import { useMonitorSetup } from "./MonitorSetupContext";
import { PanelWindowWorkspace } from "./PanelWindowWorkspace";
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

// A type change replaces the dock panel, but must keep its already-open browser window.
const replacementWindows = new Map<
  string,
  {
    child: Window;
    mode: "popout" | "pip";
    cleanup: () => void;
  }
>();

/** Mirror global/library CSS, including styles loaded by panels added after the window opens. */
function copyStyles(source: Document, target: Document): () => void {
  const copies = new Map<CSSStyleSheet, HTMLStyleElement | HTMLLinkElement>();
  const sync = () => {
    const sheets = new Set(source.styleSheets);
    for (const [sheet, copy] of copies) {
      if (!sheets.has(sheet)) {
        copy.remove();
        copies.delete(sheet);
      }
    }
    for (const sheet of sheets) {
      try {
        let copy = copies.get(sheet);
        if (!copy) {
          copy = target.createElement(sheet.href ? "link" : "style");
          if (copy instanceof target.defaultView!.HTMLLinkElement) {
            copy.rel = "stylesheet";
            copy.href = sheet.href!;
          }
          copies.set(sheet, copy);
          target.head.appendChild(copy);
        }
        copy.media = sheet.disabled ? "not all" : sheet.media.mediaText;
        if (!sheet.href) {
          const css = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
          if (copy.textContent !== css) {
            copy.textContent = css;
          }
        }
      } catch {
        // Inaccessible CSS rules must not prevent the panel window from opening.
        copies.get(sheet)?.remove();
        copies.delete(sheet);
      }
    }
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(source.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["href", "media", "disabled"],
  });
  source.head.addEventListener("load", sync, true);
  return () => {
    observer.disconnect();
    source.head.removeEventListener("load", sync, true);
    copies.forEach((copy) => {
      copy.remove();
    });
    copies.clear();
  };
}

/** Give portaled controls their own caches so new styles stay in the panel document. */
function PanelWindowStyles({ target, children }: PropsWithChildren<{ target: Window }>) {
  const outerTheme = useTheme();
  useLayoutEffect(() => copyStyles(document, target.document), [target]);
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
  return (
    <ThemeProvider isDark={outerTheme.palette.mode === "dark"} ownerDocument={target.document}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        <AppCssBaseline>{children}</AppCssBaseline>
      </MuiThemeProvider>
    </ThemeProvider>
  );
}

/** Keep the shared player/context, but recreate renderers rather than adopt a live canvas. */
export function PanelWindow({ children, title }: PropsWithChildren<{ title: string }>): ReactNode {
  const setup = useMonitorSetup();
  const layout = useContext(CurrentLayoutContext);
  const closePanelRef = useRef(setup?.closePanel);
  useLayoutEffect(() => {
    closePanelRef.current = setup?.closePanel;
  }, [setup?.closePanel]);
  const parent = useContext(PanelWindowContext);
  const dock = useContext(DockPanelContext);
  const [windowMode, setWindowMode] = useState<"popout" | "pip">("popout");
  const windowModeRef = useRef<"popout" | "pip">("popout");
  const { t } = useTranslation("panelToolbar");
  const [target, setTarget] = useState<Window>();
  const [failed, setFailed] = useState(false);
  const live = useRef(true);
  const returning = useRef(false);
  const removing = useRef(false);
  const pending = useRef(false);
  const windowRef = useRef<Window | undefined>(undefined);
  const windowCleanup = useRef<(() => void) | undefined>(undefined);
  const pip = (window as Window & { documentPictureInPicture?: DocumentPiP })
    .documentPictureInPicture;

  useEffect(() => {
    const close = () => {
      returning.current = true;
      windowRef.current?.close();
    };
    window.addEventListener("pagehide", close);
    live.current = true;
    return () => {
      live.current = false;
      window.removeEventListener("pagehide", close);
      windowCleanup.current?.();
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
      if (removing.current) {
        return;
      }
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
        returning.current = true;
        windowRef.current?.close();
      },
      open: (mode, bounds, existing) => {
        if (pending.current || windowRef.current != undefined) {
          if (bounds && windowRef.current && windowModeRef.current === "popout") {
            windowRef.current.moveTo(bounds.left, bounds.top);
            windowRef.current.resizeTo(bounds.width, bounds.height);
          }
          windowRef.current?.focus();
          return;
        }
        pending.current = true;
        returning.current = false;
        removing.current = false;
        windowModeRef.current = mode;
        setWindowMode(mode);
        setFailed(false);
        const open = async () => {
          const child =
            existing ??
            (mode === "pip"
              ? await pip?.requestWindow({ width: 800, height: 600 })
              : window.open(
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
          const viewport = document.querySelector('meta[name="viewport"]');
          if (viewport && !doc.querySelector('meta[name="viewport"]')) {
            doc.head.appendChild(viewport.cloneNode(true));
          }
          doc.documentElement.style.fontSize = window.getComputedStyle(
            document.documentElement,
          ).fontSize;
          doc.documentElement.lang = document.documentElement.lang;
          doc.documentElement.dataset.colorMode = document.documentElement.dataset.colorMode;
          if (!doc.querySelector("base")) {
            const base = doc.createElement("base");
            base.href = document.baseURI;
            doc.head.appendChild(base);
          }
          doc.body.style.cssText = "margin:0;width:100vw;height:100vh;display:flex;overflow:hidden";
          const closed = () => {
            if (windowRef.current !== child) {
              return;
            }
            windowRef.current = undefined;
            if (!live.current) {
              return;
            }
            if (!returning.current && dock && (closePanelRef.current || layout)) {
              removing.current = true;
              if (closePanelRef.current) {
                closePanelRef.current(dock.api.id);
              } else {
                layout?.actions.closePanel({ id: dock.api.id });
              }
            } else {
              setTarget(undefined);
            }
          };
          windowCleanup.current?.();
          child.addEventListener("pagehide", closed, { once: true });
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
          windowCleanup.current = () => {
            child.removeEventListener("pagehide", closed);
            for (const type of ["keydown", "keyup", "keypress"] as const) {
              doc.removeEventListener(type, key);
            }
          };
          setTarget(child);
          child.focus();
        };
        void open()
          .catch(() => {
            returning.current = true;
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
    [dock, layout, pip, target, title],
  );

  const panelId = dock?.api.id;
  useEffect(() => {
    const replacement = panelId ? replacementWindows.get(panelId) : undefined;
    if (replacement && panelId) {
      replacement.cleanup();
      actions.open(replacement.mode, undefined, replacement.child);
    }
  }, [actions, panelId]);

  const windowLayout = useMemo(() => {
    if (!layout) {
      return undefined;
    }
    return {
      ...layout,
      actions: {
        ...layout.actions,
        swapPanel: (payload: Parameters<typeof layout.actions.swapPanel>[0]) => {
          const child = windowRef.current;
          const before = layout.actions.getCurrentLayoutState().selectedLayout?.data?.configById;
          layout.actions.swapPanel(payload);
          if (!child || payload.originalId !== panelId) {
            return;
          }
          const after = layout.actions.getCurrentLayoutState().selectedLayout?.data?.configById;
          const newId = Object.keys(after ?? {}).find((id) => before?.[id] == undefined);
          if (newId) {
            const cleanup = () => {
              replacementWindows.delete(newId);
              layout.removeLayoutStateListener(checkLayout);
              window.removeEventListener("pagehide", discard);
              child.removeEventListener("pagehide", cleanup);
            };
            const discard = () => {
              cleanup();
              child.close();
            };
            const checkLayout = (state: LayoutState) => {
              const data = state.selectedLayout?.data;
              if (!data || !getAllPanelIds(data).includes(newId)) {
                discard();
              }
            };
            replacementWindows.set(newId, { child, mode: windowModeRef.current, cleanup });
            layout.addLayoutStateListener(checkLayout);
            window.addEventListener("pagehide", discard);
            child.addEventListener("pagehide", cleanup);
            windowRef.current = undefined;
          }
        },
      },
    };
  }, [layout, panelId]);

  const register = setup?.register;
  useEffect(() => {
    if (!register || !dock || parent?.isOpen === true || isDesktopApp()) {
      return;
    }
    return register(dock.api.id, {
      open: (bounds, existing) => {
        actions.open("popout", bounds, existing);
      },
      getWindow: () => (windowModeRef.current === "popout" ? windowRef.current : undefined),
      isOpen: actions.isOpen,
    });
  }, [actions, dock, parent?.isOpen, register]);

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
              <DockPanelContext.Provider value={undefined}>
                <CurrentLayoutContext.Provider value={windowLayout}>
                  <PanelWindowWorkspace target={target} title={title} rootId={dock?.api.id}>
                    {children}
                  </PanelWindowWorkspace>
                </CurrentLayoutContext.Provider>
              </DockPanelContext.Provider>
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
