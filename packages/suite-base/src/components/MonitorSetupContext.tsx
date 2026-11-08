// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Alert, Snackbar } from "@mui/material";
import {
  createContext,
  PropsWithChildren,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { LOCAL_STORAGE_MONITOR_SETUP } from "@lichtblick/suite-base/constants/browserStorageKeys";
import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";
import { getPanelIdForType, PANEL_TITLE_CONFIG_KEY } from "@lichtblick/suite-base/util/layout";
import {
  getAllPanelIds,
  findLayoutTree,
  DEFAULT_TAB_PANEL_CONFIG,
  TAB_PANEL_TYPE,
} from "@lichtblick/suite-base/util/tabLayout";

import {
  captureMonitor,
  capturePanelConfigs,
  monitorScreens,
  readMonitorSetup,
  restoreMonitorBounds,
  WindowBounds,
} from "./monitorSetup";

type MonitorPanel = {
  open: (bounds?: WindowBounds, existing?: Window) => void;
  getWindow: () => Window | undefined;
  isOpen: boolean;
};
type MonitorSetup = {
  register: (id: string, panel: MonitorPanel) => () => void;
  newWindow: () => void;
  closePanel: (id: string) => void;
  save: () => void;
  restore: () => void;
  canSave: boolean;
  canRestore: boolean;
  busy: boolean;
  detachedPanelIds: readonly string[];
};
const MonitorSetupContext = createContext<MonitorSetup | undefined>(undefined);
export const useMonitorSetup = (): MonitorSetup | undefined => useContext(MonitorSetupContext);
const selectLayoutId = (state: LayoutState) => state.selectedLayout?.id;
const selectLayoutReady = (state: LayoutState) => state.selectedLayout?.data != undefined;

/** Local window placement stays outside portable/synced layout data. Nothing reopens without a click. */
function WebMonitorSetupProvider({ children }: PropsWithChildren) {
  const layoutId = useCurrentLayoutSelector(selectLayoutId);
  const layoutReady = useCurrentLayoutSelector(selectLayoutReady);
  const {
    addPanel,
    getCurrentLayoutState,
    savePanelConfigs,
    closePanel: removePanel,
  } = useCurrentLayoutActions();
  const layoutManager = useLayoutManager();
  const { t } = useTranslation("appBar");
  const key = `${LOCAL_STORAGE_MONITOR_SETUP}${layoutId ?? ""}`;
  const [saved, setSaved] = useState(() => readMonitorSetup(key));
  const [panels, setPanels] = useState(new Map<string, MonitorPanel>());
  const panelsRef = useRef(new Map<string, MonitorPanel>());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    text: string;
    severity: "success" | "warning" | "error";
  }>();
  const pending = useRef(new Map<string, { child: Window; bounds?: WindowBounds }>());
  const operation = useRef({ version: 0 });
  useEffect(() => {
    setSaved(readMonitorSetup(key));
    setBusy(false);
    const waiting = pending.current;
    const currentOperation = operation.current;
    return () => {
      currentOperation.version++;
      waiting.forEach(({ child }) => {
        child.close();
      });
      waiting.clear();
    };
  }, [key]);
  const register = useCallback((id: string, panel: MonitorPanel) => {
    panelsRef.current.set(id, panel);
    setPanels(new Map(panelsRef.current));
    const waiting = pending.current.get(id);
    if (waiting) {
      pending.current.delete(id);
      panel.open(waiting.bounds, waiting.child);
    }
    return () => {
      if (panelsRef.current.get(id) === panel) {
        panelsRef.current.delete(id);
        setPanels(new Map(panelsRef.current));
      }
    };
  }, []);

  const value = useMemo<MonitorSetup>(
    () => ({
      register,
      busy,
      detachedPanelIds: [...panels].filter(([, panel]) => panel.isOpen).map(([id]) => id),
      canSave:
        layoutId != undefined &&
        [...panels.values()].some((panel) => panel.getWindow() != undefined),
      canRestore:
        layoutReady &&
        layoutId != undefined &&
        saved.some((item) => panels.has(item.panelId) || item.configs != undefined),
      closePanel: (id) => {
        const data = getCurrentLayoutState().selectedLayout?.data;
        if (data && saved.some((item) => item.panelId === id)) {
          const next = saved.map((item) =>
            item.panelId === id ? { ...item, configs: capturePanelConfigs(data, id) } : item,
          );
          try {
            localStorage.setItem(key, JSON.stringify(next)!);
            setSaved(next);
          } catch {
            setNotice({ text: t("monitorSetupSaveFailed"), severity: "error" });
          }
        }
        removePanel({ id });
      },
      newWindow: () => {
        if (layoutId == undefined || getCurrentLayoutState().selectedLayout?.data == undefined) {
          return;
        }
        const child = window.open("about:blank", "_blank", "popup,width=1000,height=700");
        if (!child) {
          setNotice({ text: t("monitorWindowBlocked"), severity: "error" });
          return;
        }
        const id = getPanelIdForType(TAB_PANEL_TYPE);
        pending.current.set(id, { child });
        try {
          addPanel({
            id,
            config: {
              ...DEFAULT_TAB_PANEL_CONFIG,
              isWindow: true,
              [PANEL_TITLE_CONFIG_KEY]: t("newWindow"),
            },
          });
        } catch {
          pending.current.delete(id);
          child.close();
          setNotice({ text: t("monitorWindowBlocked"), severity: "error" });
        }
      },
      save: () => {
        const version = operation.current.version;
        setBusy(true);
        void monitorScreens()
          .then(async (screens) => {
            if (operation.current.version !== version) {
              return;
            }
            const layout = getCurrentLayoutState().selectedLayout;
            if (layout == undefined || layout.id !== layoutId || layout.data == undefined) {
              return;
            }
            // Flush the working copy before confirming; automatic layout persistence is debounced.
            await layoutManager.updateLayout({ id: layout.id, data: layout.data });
            if (operation.current.version !== version) {
              return;
            }
            const setup = [...panels].flatMap(([id, panel]) => {
              const child = panel.getWindow();
              return child && !child.closed
                ? [
                    {
                      ...captureMonitor(id, child, screens),
                      configs: capturePanelConfigs(layout.data!, id),
                    },
                  ]
                : [];
            });
            if (setup.length === 0) {
              return;
            }
            localStorage.setItem(key, JSON.stringify(setup)!);
            setSaved(setup);
            setNotice({ text: t("monitorSetupSaved"), severity: "success" });
          })
          .catch(() => {
            if (operation.current.version === version) {
              setNotice({ text: t("monitorSetupSaveFailed"), severity: "error" });
            }
          })
          .finally(() => {
            if (operation.current.version === version) {
              setBusy(false);
            }
          });
      },
      restore: () => {
        const version = operation.current.version;
        // Open synchronously while the click is active; screen permission may take arbitrarily long.
        for (const item of saved) {
          const panel = panelsRef.current.get(item.panelId);
          if (panel) {
            panel.open();
          } else if (item.configs && !pending.current.has(item.panelId)) {
            const configs = capturePanelConfigs({ configById: item.configs }, item.panelId);
            const current = getCurrentLayoutState().selectedLayout?.data;
            const currentIds = current ? getAllPanelIds(current) : [];
            const exists = currentIds.includes(item.panelId);
            const openParent =
              current != undefined &&
              findLayoutTree(current, item.panelId)?.location.ancestors.some(
                (id) => panelsRef.current.get(id)?.isOpen === true,
              );
            if (
              !current ||
              openParent === true ||
              (!exists && currentIds.some((id) => Object.hasOwn(configs, id)))
            ) {
              setNotice({ text: t("monitorSetupRestoreFailed"), severity: "error" });
              continue;
            }
            const child = window.open("about:blank", "_blank", "popup,width=1000,height=700");
            if (!child) {
              setNotice({ text: t("monitorWindowBlocked"), severity: "error" });
              continue;
            }
            pending.current.set(item.panelId, { child });
            try {
              // An existing panel may still be mounting; registration adopts the preopened window.
              if (!exists) {
                savePanelConfigs({
                  configs: Object.entries(configs).map(([id, config]) => ({ id, config })),
                });
                addPanel({ id: item.panelId, config: item.configs[item.panelId] });
              }
            } catch {
              pending.current.delete(item.panelId);
              child.close();
              setNotice({ text: t("monitorSetupRestoreFailed"), severity: "error" });
            }
          }
        }
        setBusy(true);
        void monitorScreens()
          .then((screens) => {
            if (operation.current.version !== version) {
              return;
            }
            for (const item of saved) {
              const bounds = restoreMonitorBounds(item, screens);
              const panel = panelsRef.current.get(item.panelId);
              const waiting = pending.current.get(item.panelId);
              if (waiting) {
                waiting.bounds = bounds;
              } else if (panel?.getWindow()) {
                panel.open(bounds);
              }
            }
            if (saved.some((item) => !panelsRef.current.has(item.panelId) && !item.configs)) {
              setNotice({ text: t("monitorPanelsMissing"), severity: "warning" });
            }
          })
          .catch(() => {
            if (operation.current.version === version) {
              setNotice({ text: t("monitorSetupRestoreFailed"), severity: "error" });
            }
          })
          .finally(() => {
            if (operation.current.version === version) {
              setBusy(false);
            }
          });
      },
    }),
    [
      addPanel,
      busy,
      getCurrentLayoutState,
      key,
      layoutId,
      layoutReady,
      layoutManager,
      panels,
      register,
      removePanel,
      savePanelConfigs,
      saved,
      t,
    ],
  );

  return (
    <MonitorSetupContext.Provider value={value}>
      {children}
      <Snackbar
        open={notice != undefined}
        autoHideDuration={6000}
        onClose={() => {
          setNotice(undefined);
        }}
      >
        <Alert
          severity={notice?.severity}
          onClose={() => {
            setNotice(undefined);
          }}
        >
          {notice?.text}
        </Alert>
      </Snackbar>
    </MonitorSetupContext.Provider>
  );
}

/** Keep desktop outside the web window-management lifecycle. */
export function MonitorSetupProvider({ children }: PropsWithChildren): ReactNode {
  return isDesktopApp() ? children : <WebMonitorSetupProvider>{children}</WebMonitorSetupProvider>;
}
