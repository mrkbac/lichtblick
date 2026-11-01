// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Add16Regular, Dismiss12Regular } from "@fluentui/react-icons";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  KEY_WORKSPACE_PREFIX,
  LOCAL_STORAGE_APP_CONFIGURATION,
  LOCAL_STORAGE_PROFILE_DATA,
} from "@lichtblick/suite-base/constants/browserStorageKeys";
import { palette } from "@lichtblick/theme";

// Each tab is a same-origin iframe running the whole app, so tabs get their own data source,
// layout, playback, URL and keyboard focus without the app knowing it runs in a tab.

type Tab = {
  id: string;
  /** URL the iframe was created with; changing an iframe's src would reload it */
  src: string;
  /** current URL of the tab, kept up to date while it plays */
  url: string;
  title: string;
  /** layout selected in the tab; the app remembers only one layout for all tabs */
  layoutId?: string;
};

type SavedTabs = { tabs: Tab[]; activeId: string };

const SESSION_STORAGE_TABS = `${KEY_WORKSPACE_PREFIX}studio.workspace-tabs`;
const COLOR_SCHEME_KEY = `${LOCAL_STORAGE_APP_CONFIGURATION}colorScheme`;
const STRIP_BACKGROUND = "#18181c";

function newTab(url: string): Tab {
  return { id: crypto.randomUUID(), src: url, url, title: "Lichtblick" };
}

function blankTabUrl(): string {
  const url = new URL(window.location.pathname, window.location.origin);
  const workspace = new URL(window.location.href).searchParams.get("workspace");
  if (workspace != undefined) {
    url.searchParams.set("workspace", workspace);
  }
  return url.href;
}

function withLayout(href: string, layoutId: string | undefined): string {
  if (layoutId == undefined) {
    return href;
  }
  const url = new URL(href);
  url.searchParams.set("layoutId", layoutId);
  return url.href;
}

function loadTabs(): SavedTabs {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_TABS) ?? "") as SavedTabs;
    const active = saved.tabs.find((tab) => tab.id === saved.activeId);
    if (active) {
      // Reloading restores every tab; the address bar wins for the active one so pasted links work.
      const tabs = saved.tabs.map((tab) => {
        const url = tab === active ? window.location.href : tab.url;
        return { ...tab, src: withLayout(url, tab.layoutId), url };
      });
      return { tabs, activeId: active.id };
    }
  } catch {
    // nothing saved yet
  }
  const tab = newTab(window.location.href);
  return { tabs: [tab], activeId: tab.id };
}

function useIsDark(): boolean {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const compute = () => {
    let scheme = "system";
    try {
      scheme = JSON.parse(localStorage.getItem(COLOR_SCHEME_KEY) ?? '"system"') as string;
    } catch {
      // keep "system"
    }
    return scheme === "dark" || (scheme !== "light" && query.matches);
  };
  const [isDark, setIsDark] = useState(compute);
  useEffect(() => {
    // The settings are changed inside a tab, which fires "storage" in this document.
    const update = () => {
      setIsDark(compute());
    };
    window.addEventListener("storage", update);
    query.addEventListener("change", update);
    return () => {
      window.removeEventListener("storage", update);
      query.removeEventListener("change", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return isDark;
}

const css = `
.tabshell { position: fixed; inset: 0; display: flex; flex-direction: column; background: ${STRIP_BACKGROUND}; }
.tabshell-strip {
  display: flex; align-items: flex-end; gap: 2px; flex: none;
  height: env(titlebar-area-height, 34px);
  padding-left: calc(env(titlebar-area-x, 0px) + 6px);
  padding-right: calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%));
  -webkit-app-region: drag; app-region: drag;
  font: 12px/1 Inter, system-ui, sans-serif; color: #ffffff;
}
.tabshell-tab, .tabshell-add { -webkit-app-region: no-drag; app-region: no-drag; }
.tabshell-tab {
  display: flex; align-items: center; gap: 6px; min-width: 60px; max-width: 220px; flex: 1 1 220px;
  height: calc(100% - 4px); padding: 0 6px 0 12px; border-radius: 6px 6px 0 0;
  color: #a7a6af; cursor: default; user-select: none;
}
.tabshell-tab:hover { background: #ffffff10; color: #ffffff; }
.tabshell-tab[aria-selected="true"] { background: var(--tabshell-active); color: #ffffff; }
.tabshell-title { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tabshell-close, .tabshell-add {
  display: flex; align-items: center; justify-content: center; flex: none;
  border: 0; border-radius: 4px; padding: 0; background: none; color: inherit;
}
.tabshell-close { width: 18px; height: 18px; visibility: hidden; }
.tabshell-tab:hover .tabshell-close, .tabshell-tab[aria-selected="true"] .tabshell-close { visibility: visible; }
.tabshell-close:hover, .tabshell-add:hover { background: #ffffff20; }
.tabshell-add { width: 26px; height: 26px; margin: 0 0 3px 4px; color: #a7a6af; }
.tabshell-frames { position: relative; flex: 1; }
.tabshell-frames iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
`;

const isMac = navigator.userAgent.includes("Mac");

export function TabShell(): React.JSX.Element {
  const [{ tabs, activeId }, setState] = useState(loadTabs);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const dragId = useRef<string>();
  const isDark = useIsDark();
  const activeColor = (isDark ? palette.dark : palette.light).appBar.main;

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]!;

  const updateTab = useCallback((id: string, patch: Partial<Tab>) => {
    setState((state) => ({
      ...state,
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)),
    }));
  }, []);

  const addTab = useCallback(() => {
    const tab = newTab(blankTabUrl());
    setState((state) => ({ tabs: [...state.tabs, tab], activeId: tab.id }));
  }, []);

  const closeTab = useCallback((id: string) => {
    setState((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      const remaining = state.tabs.filter((tab) => tab.id !== id);
      if (remaining.length === 0) {
        const tab = newTab(blankTabUrl());
        return { tabs: [tab], activeId: tab.id };
      }
      const nextActiveId =
        state.activeId === id
          ? remaining[Math.min(index, remaining.length - 1)]!.id
          : state.activeId;
      return { tabs: remaining, activeId: nextActiveId };
    });
  }, []);

  const selectRelative = useCallback((offset: number) => {
    setState((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === state.activeId);
      const next = state.tabs[(index + offset + state.tabs.length) % state.tabs.length]!;
      return { ...state, activeId: next.id };
    });
  }, []);

  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeTab.id;

  // Keyboard shortcuts. Browsers reserve Ctrl/Cmd+T and Ctrl/Cmd+W, so new/close use Alt.
  // Ctrl+Tab only reaches the page in the installed PWA, so Alt+[ and Alt+] cycle too.
  // Key events stay inside the focused iframe, so the handler is installed on every tab too.
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (event.altKey && !mod && event.code === "KeyT") {
        addTab();
      } else if (event.altKey && !mod && event.code === "KeyW") {
        closeTab(activeIdRef.current);
      } else if (event.ctrlKey && event.code === "Tab") {
        selectRelative(event.shiftKey ? -1 : 1);
      } else if (event.altKey && !mod && event.code === "BracketLeft") {
        selectRelative(-1);
      } else if (event.altKey && !mod && event.code === "BracketRight") {
        selectRelative(1);
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [addTab, closeTab, selectRelative],
  );
  const onKeyDownRef = useRef(onKeyDown);
  onKeyDownRef.current = onKeyDown;

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onKeyDown]);

  // Watch a tab's title and URL. The app keeps its URL current with history.replaceState.
  const onFrameLoad = useCallback(
    (id: string, iframe: HTMLIFrameElement) => {
      const win = iframe.contentWindow;
      const doc = iframe.contentDocument;
      if (!win || !doc) {
        return;
      }
      const syncUrl = () => {
        updateTab(id, { url: win.location.href });
      };
      const replaceState = win.history.replaceState.bind(win.history);
      win.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
        replaceState(...args);
        syncUrl();
      };
      syncUrl();

      const syncTitle = () => {
        updateTab(id, { title: doc.title || "Lichtblick" });
      };
      new MutationObserver(syncTitle).observe(doc.head, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      syncTitle();

      // Remember which layout the tab picks, so a reload restores each tab's own layout.
      const parseLayoutId = (profile: string | null) => {
        try {
          return (JSON.parse(profile ?? "{}") as { currentLayoutId?: string }).currentLayoutId;
        } catch {
          return undefined;
        }
      };
      // A tab may pick its first layout (the remembered one) before this runs.
      const rememberedLayoutId = parseLayoutId(localStorage.getItem(LOCAL_STORAGE_PROFILE_DATA));
      setState((state) => ({
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === id && tab.layoutId == undefined
            ? { ...tab, layoutId: rememberedLayoutId }
            : tab,
        ),
      }));
      // The tab's own Storage prototype, so other tabs and this page are unaffected.
      const storage = Object.getPrototypeOf(win.localStorage) as Storage;
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const setItem = storage.setItem;
      storage.setItem = function (this: Storage, key: string, value: string) {
        setItem.call(this, key, value);
        if (key === LOCAL_STORAGE_PROFILE_DATA) {
          updateTab(id, { layoutId: parseLayoutId(value) });
        }
      };

      win.addEventListener(
        "keydown",
        (event) => {
          onKeyDownRef.current(event);
        },
        true,
      );
    },
    [updateTab],
  );

  // Mirror the active tab into the address bar and window title, and remember all tabs.
  useEffect(() => {
    if (window.location.href !== activeTab.url) {
      window.history.replaceState(undefined, "", activeTab.url);
    }
    document.title = activeTab.title;
    try {
      sessionStorage.setItem(SESSION_STORAGE_TABS, JSON.stringify({ tabs, activeId }) ?? "");
    } catch {
      // storage full or disabled; tabs just won't survive a reload
    }
  }, [activeTab, tabs, activeId]);

  const stripRef = useRef<HTMLDivElement>(ReactNull);
  useEffect(() => {
    // Arrow keys in the tab strip keep focus there; anything else hands focus to the tab.
    if (stripRef.current?.contains(document.activeElement) === true) {
      stripRef.current.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    } else {
      frames.current.get(activeTab.id)?.contentWindow?.focus();
    }
  }, [activeTab.id]);

  // Color the browser's own title bar controls (installed PWA) like the tab strip.
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = STRIP_BACKGROUND;
  }, []);

  return (
    <div className="tabshell" style={{ "--tabshell-active": activeColor } as React.CSSProperties}>
      <style>{css}</style>
      <div className="tabshell-strip" role="tablist" ref={stripRef}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="tabshell-tab"
            role="tab"
            aria-selected={tab.id === activeTab.id}
            tabIndex={tab.id === activeTab.id ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                selectRelative(event.key === "ArrowRight" ? 1 : -1);
              } else if (event.key === "Delete") {
                closeTab(tab.id);
              } else if (event.key === "Enter" || event.key === " ") {
                frames.current.get(tab.id)?.contentWindow?.focus();
              } else {
                return;
              }
              event.preventDefault();
            }}
            title={tab.title}
            draggable
            onMouseDown={(event) => {
              if (event.button === 0) {
                setState((state) => ({ ...state, activeId: tab.id }));
              }
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                closeTab(tab.id);
              }
            }}
            onDragStart={() => {
              dragId.current = tab.id;
            }}
            onDragOver={(event) => {
              const from = dragId.current;
              if (from == undefined || from === tab.id) {
                return;
              }
              event.preventDefault();
              setState((state) => {
                const moving = state.tabs.find((t) => t.id === from)!;
                const rest = state.tabs.filter((t) => t.id !== from);
                rest.splice(
                  state.tabs.findIndex((t) => t.id === tab.id),
                  0,
                  moving,
                );
                return { ...state, tabs: rest };
              });
            }}
            onDragEnd={() => {
              dragId.current = undefined;
            }}
          >
            <span className="tabshell-title">{tab.title}</span>
            <button
              className="tabshell-close"
              aria-label="Close tab"
              title={`Close tab (${isMac ? "⌥" : "Alt+"}W)`}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onClick={() => {
                closeTab(tab.id);
              }}
            >
              <Dismiss12Regular />
            </button>
          </div>
        ))}
        <button
          className="tabshell-add"
          aria-label="New tab"
          title={`New tab (${isMac ? "⌥" : "Alt+"}T)`}
          onClick={addTab}
        >
          <Add16Regular />
        </button>
      </div>
      <div className="tabshell-frames">
        {tabs.map((tab) => (
          <iframe
            key={tab.id}
            title={tab.title}
            src={tab.src}
            allowFullScreen
            // visibility keeps a background tab at full size, so its panels don't re-layout
            // when it comes back. ponytail: background tabs keep rendering; pause them if
            // several heavy tabs make the active one stutter.
            style={{ visibility: tab.id === activeTab.id ? "visible" : "hidden" }}
            ref={(el) => {
              if (el) {
                frames.current.set(tab.id, el);
              } else {
                frames.current.delete(tab.id);
              }
            }}
            onLoad={(event) => {
              onFrameLoad(tab.id, event.currentTarget);
            }}
          />
        ))}
      </div>
    </div>
  );
}
