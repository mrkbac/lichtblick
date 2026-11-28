// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { shallow } from "zustand/shallow";

import { useAsync, useAsyncFn, useMountedState, useShallowMemo } from "@lichtblick/hooks";
import Logger from "@lichtblick/log";
import { VariableValue } from "@lichtblick/suite";
import { useAppParameters } from "@lichtblick/suite-base/context/AppParametersContext";
import CurrentLayoutContext, {
  ICurrentLayout,
  LayoutID,
  LayoutState,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import {
  AddPanelPayload,
  ChangePanelLayoutPayload,
  ClosePanelPayload,
  GroupPanelsPayload,
  LayoutData,
  PanelsActions,
  SaveConfigsPayload,
  SplitPanelPayload,
  SwapPanelPayload,
} from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import { useUserProfileStorage } from "@lichtblick/suite-base/context/UserProfileStorageContext";
import {
  BUSY_POLLING_INTERVAL_MS,
  BUSY_POLLING_TIMEOUT_MS,
  DEFAULT_LAYOUT,
  FAVORITES_TIMEOUT_MS,
  MAX_SUPPORTED_LAYOUT_VERSION,
  ORG_PERMISSION_PREFIX,
} from "@lichtblick/suite-base/providers/CurrentLayoutProvider/constants";
import useUpdateSharedPanelState from "@lichtblick/suite-base/providers/CurrentLayoutProvider/hooks/useUpdateSharedPanelState";
import { LayoutHistory } from "@lichtblick/suite-base/providers/CurrentLayoutProvider/layoutHistory";
import { loadDefaultLayouts } from "@lichtblick/suite-base/providers/CurrentLayoutProvider/loadDefaultLayouts";
import {
  findFavoriteLayout,
  pruneSharedPanelState,
} from "@lichtblick/suite-base/providers/CurrentLayoutProvider/utils";
import { LayoutLoader } from "@lichtblick/suite-base/services/ILayoutLoader";
import { LayoutManagerEventTypes } from "@lichtblick/suite-base/services/ILayoutManager";
import {
  deleteLayoutHistory,
  loadLayoutHistory,
  saveLayoutHistory,
} from "@lichtblick/suite-base/services/layoutHistoryStorage";
import { migratePanelsState } from "@lichtblick/suite-base/services/migrateLayout";
import { PanelConfig, PlaybackConfig, UserScripts } from "@lichtblick/suite-base/types/panels";
import { windowAppURLState } from "@lichtblick/suite-base/util/appURLState";
import { toError } from "@lichtblick/suite-base/util/toError";

import { IncompatibleLayoutVersionAlert } from "./IncompatibleLayoutVersionAlert";

const log = Logger.getLogger(__filename);

/** Whether this page load is a reload (browser reload, an update's reload) rather than a new start. */
function isPageReload(): boolean {
  const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return navigation?.type === "reload";
}

/**
 * Concrete implementation of CurrentLayoutContext.Provider which handles
 * automatically restoring the current layout from LayoutStorage.
 */
export default function CurrentLayoutProvider({
  children,
  loaders = [],
}: React.PropsWithChildren<{
  loaders?: readonly LayoutLoader[];
}>): React.JSX.Element {
  const { enqueueSnackbar } = useSnackbar();
  const { getUserProfile, setUserProfile } = useUserProfileStorage();
  const layoutManager = useLayoutManager();
  const isMounted = useMountedState();

  const { t } = useTranslation("general");

  const appParameters = useAppParameters();

  const layoutStateListeners = useRef(new Set<(_: LayoutState) => void>());
  const addLayoutStateListener = useCallback((listener: (_: LayoutState) => void) => {
    layoutStateListeners.current.add(listener);
  }, []);
  const removeLayoutStateListener = useCallback((listener: (_: LayoutState) => void) => {
    layoutStateListeners.current.delete(listener);
  }, []);

  // A ref, not state: consumers subscribe through the listeners, so re-rendering the provider on
  // every layout edit would only cost time
  const layoutStateRef = useRef<LayoutState>({ selectedLayout: undefined });
  const [incompatibleLayoutVersionError, setIncompatibleLayoutVersionError] = useState(false);
  const setLayoutState = useCallback((newState: LayoutState) => {
    const layoutVersion = newState.selectedLayout?.data?.version;
    // A layout from a newer build can't be shown: select none, so nothing stays loading
    const state =
      layoutVersion != undefined && layoutVersion > MAX_SUPPORTED_LAYOUT_VERSION
        ? { selectedLayout: undefined }
        : newState;
    if (state !== newState) {
      setIncompatibleLayoutVersionError(true);
    }

    // listeners rely on being able to getCurrentLayoutState() inside effects that may run before we re-render
    layoutStateRef.current = state;

    for (const listener of [...layoutStateListeners.current]) {
      listener(state);
    }
  }, []);

  const selectedPanelIds = useRef<readonly string[]>([]);
  const selectedPanelIdsListeners = useRef(new Set<(_: readonly string[]) => void>());
  const addSelectedPanelIdsListener = useCallback((listener: (_: readonly string[]) => void) => {
    selectedPanelIdsListeners.current.add(listener);
  }, []);
  const removeSelectedPanelIdsListener = useCallback((listener: (_: readonly string[]) => void) => {
    selectedPanelIdsListeners.current.delete(listener);
  }, []);

  const getSelectedPanelIds = useCallback(() => selectedPanelIds.current, []);
  const setSelectedPanelIds = useCallback(
    (value: readonly string[] | ((prevState: readonly string[]) => readonly string[])): void => {
      const newValue = typeof value === "function" ? value(selectedPanelIds.current) : value;
      if (!shallow(newValue, selectedPanelIds.current)) {
        selectedPanelIds.current = newValue;
        for (const listener of [...selectedPanelIdsListeners.current]) {
          listener(selectedPanelIds.current);
        }
      }
    },
    [],
  );

  const history = useRef(new LayoutHistory());
  /** The layout `history` belongs to; unset while another layout loads. */
  const historyLayoutId = useRef<LayoutID | undefined>(undefined);
  /** A revert of the layout being loaded, applied once its history is ready. */
  const revertedWhileLoading = useRef<{ id: LayoutID; data: LayoutData } | undefined>(undefined);
  useEffect(
    () =>
      history.current.subscribe(() => {
        if (historyLayoutId.current != undefined) {
          saveLayoutHistory(historyLayoutId.current, history.current.snapshot());
        }
      }),
    [],
  );

  /** Bumped by every selection, so a slower earlier one can tell it was superseded. */
  const selectionSeq = useRef(0);

  const [, setSelectedLayoutId] = useAsyncFn(
    async (
      id: LayoutID | undefined,
      { saveToProfile = true }: { saveToProfile?: boolean } = {},
    ) => {
      const seq = ++selectionSeq.current;
      const superseded = () => !isMounted() || seq !== selectionSeq.current;
      if (id == undefined) {
        setLayoutState({ selectedLayout: undefined });
        return;
      }
      try {
        historyLayoutId.current = undefined;
        // Typed so TS doesn't keep it narrowed to undefined across the awaits below.
        revertedWhileLoading.current = undefined as typeof revertedWhileLoading.current;
        // Keep showing the previous layout while loading, so panels both layouts share stay mounted.
        const previous = layoutStateRef.current.selectedLayout?.data;
        setLayoutState({ selectedLayout: { id, loading: true, data: previous } });
        const layout = await layoutManager.getLayout(id);
        if (superseded()) {
          return;
        }
        const layoutVersion = layout?.baseline.data.version;
        if (layoutVersion != undefined && layoutVersion > MAX_SUPPORTED_LAYOUT_VERSION) {
          setIncompatibleLayoutVersionError(true);
          setLayoutState({ selectedLayout: undefined });
          return;
        }
        if (!isMounted()) {
          return;
        }
        setIncompatibleLayoutVersionError(false);
        if (layout == undefined) {
          setLayoutState({ selectedLayout: undefined });
        } else {
          const saved = await loadLayoutHistory(layout.id).catch((error: unknown) => {
            log.error(error);
            return undefined;
          });
          if (superseded()) {
            return;
          }
          const reverted = revertedWhileLoading.current;
          revertedWhileLoading.current = undefined;
          historyLayoutId.current = layout.id;
          let data = history.current.load(
            saved,
            migratePanelsState(layout.working?.data ?? layout.baseline.data),
          );
          if (reverted?.id === layout.id) {
            // Like any revert: a step after the loaded state, so undo brings that back.
            history.current.sync(reverted.data);
            data = reverted.data;
          }
          setLayoutState({
            selectedLayout: {
              loading: false,
              id: layout.id,
              data,
              name: layout.name,
              externalEdit: true,
            },
          });
          if (saveToProfile) {
            setUserProfile({ currentLayoutId: id }).catch((error: unknown) => {
              console.error(error);
              enqueueSnackbar(`The current layout could not be saved. ${String(error)}`, {
                variant: "error",
              });
            });
          }
        }
      } catch (error) {
        if (superseded()) {
          return;
        }
        console.error(error);
        enqueueSnackbar(`The layout could not be loaded. ${toError(error).toString()}`, {
          variant: "error",
        });
        setIncompatibleLayoutVersionError(false);
        setLayoutState({ selectedLayout: undefined });
      }
    },
    [enqueueSnackbar, isMounted, layoutManager, setLayoutState, setUserProfile],
  );

  /** Every layout edit goes through here, so undo/redo sees all of them. */
  const commitLayoutData = useCallback(
    (
      edit: (history: LayoutHistory, data: LayoutData) => LayoutData | undefined,
      { externalEdit = false }: { externalEdit?: boolean } = {},
    ) => {
      const selected = layoutStateRef.current.selectedLayout;
      if (selected?.data == undefined || selected.loading === true) {
        return;
      }
      const newData = edit(history.current, selected.data);
      if (newData == undefined) {
        return;
      }

      setLayoutState({
        sharedPanelState: pruneSharedPanelState(
          layoutStateRef.current.sharedPanelState,
          newData.configById,
        ),
        selectedLayout: {
          id: selected.id,
          data: newData,
          name: selected.name,
          edited: true,
          externalEdit,
        },
      });
    },
    [setLayoutState],
  );

  const performAction = useCallback(
    (action: PanelsActions) => {
      commitLayoutData((h, data) => h.apply(data, action, performance.now()));
    },
    [commitLayoutData],
  );

  /**
   * Changes to the layout storage from external user actions need to trigger setLayoutState.
   * Before it was beeing trigged on every change. Now it is triggered only when the layout
   * is reverted, otherize it has some toggling issues when resizing panels.
   */
  useEffect(() => {
    const listener: LayoutManagerEventTypes["change"] = (event) => {
      const { updatedLayout } = event;
      if (
        event.type === "revert" &&
        updatedLayout &&
        updatedLayout.id === layoutStateRef.current.selectedLayout?.id
      ) {
        const data = migratePanelsState(updatedLayout.working?.data ?? updatedLayout.baseline.data);
        if (historyLayoutId.current !== updatedLayout.id) {
          // Still loading: the load shows it once the layout's own history is ready.
          revertedWhileLoading.current = { id: updatedLayout.id, data };
          return;
        }
        // A revert is a step of the layout's history, so it can be undone.
        history.current.sync(data);
        setLayoutState({
          selectedLayout: {
            loading: false,
            id: updatedLayout.id,
            data,
            name: updatedLayout.name,
            externalEdit: true,
          },
        });
      }
    };
    layoutManager.on("change", listener);
    return () => {
      layoutManager.off("change", listener);
    };
  }, [layoutManager, setLayoutState]);

  // Make sure our layout still exists after changes. If not deselect it.
  useEffect(() => {
    const listener: LayoutManagerEventTypes["change"] = async (event) => {
      if (event.type === "delete") {
        // Edits until another layout is selected must not save the deleted history again.
        if (historyLayoutId.current === event.layoutId) {
          historyLayoutId.current = undefined;
        }
        deleteLayoutHistory(event.layoutId).catch((error: unknown) => {
          log.error(error);
        });
      }
      if (event.type !== "delete" || !layoutStateRef.current.selectedLayout?.id) {
        return;
      }

      if (event.layoutId === layoutStateRef.current.selectedLayout.id) {
        const layouts = await layoutManager.getLayouts();
        await setSelectedLayoutId(layouts[0]?.id);
      }
    };

    layoutManager.on("change", listener);
    return () => {
      layoutManager.off("change", listener);
    };
  }, [enqueueSnackbar, layoutManager, setSelectedLayoutId]);

  // Load initial state by re-selecting the last selected layout from the UserProfile.
  useAsync(async () => {
    // Don't restore the layout if there's one specified in the app state url.
    if (windowAppURLState()?.layoutId) {
      return;
    }

    // A layout picked while this runs (e.g. installed from a `layoutUrl` link) wins over the
    // startup choice, so every selection below goes through here.
    const startSeq = selectionSeq.current;
    const selectInitial = async (id: LayoutID, options?: { saveToProfile?: boolean }) => {
      if (selectionSeq.current === startSeq) {
        await setSelectedLayoutId(id, options);
      }
    };

    // For some reason, this needs to go before the setSelectedLayoutId, probably some initialization
    const { currentLayoutId } = await getUserProfile();

    // Try to load default layouts, before checking to add the fallback "Default".
    await loadDefaultLayouts(layoutManager, loaders);

    // Wait for layout manager to finish any ongoing operations (e.g. fetching remote layouts)
    if (layoutManager.isBusy()) {
      await new Promise<void>((resolve) => {
        const startTime = Date.now();

        const checkBusy = () => {
          const elapsed = Date.now() - startTime;

          if (!layoutManager.isBusy()) {
            resolve();
          } else if (elapsed >= BUSY_POLLING_TIMEOUT_MS) {
            console.warn(
              `CurrentLayoutProvider: timeout after ${BUSY_POLLING_TIMEOUT_MS}ms, continuing anyway`,
            );
            resolve();
          } else {
            setTimeout(checkBusy, BUSY_POLLING_INTERVAL_MS);
          }
        };
        checkBusy();
      });
    }

    const layouts = await layoutManager.getLayouts();

    // Check if there's a layout specified by app parameter. When multiple layouts share the
    // name, prefer the organizational (shared) layout over a local one.
    const matchingLayouts = layouts.filter((l) => l.name === appParameters.defaultLayout);
    const defaultLayoutFromParameters =
      matchingLayouts.find((l) => l.permission.startsWith(ORG_PERMISSION_PREFIX)) ??
      matchingLayouts[0];
    if (defaultLayoutFromParameters) {
      // Apply the URL-selected layout for the current session only, without persisting it to the
      // user's profile, so a one-off ?layout= override does not become sticky on later visits.
      await selectInitial(defaultLayoutFromParameters.id, { saveToProfile: false });
      return;
    }

    // It there is a defaultLayout setted but didnt found a layout, show a error to the user
    if (appParameters.defaultLayout) {
      enqueueSnackbar(t("noDefaultLayoutParameter", { layoutName: appParameters.defaultLayout }), {
        variant: "warning",
      });
    }

    // If remote favorites take too long, fall back to the ones loaded so far (usually personal).
    let clearFavoritesTimeout = () => {};
    const loadedFavorites = await Promise.race([
      layoutManager.loadFavorites(),
      new Promise<undefined>((resolve) => {
        const timeoutId = setTimeout(resolve, FAVORITES_TIMEOUT_MS);
        clearFavoritesTimeout = () => {
          clearTimeout(timeoutId);
        };
      }),
    ]);
    clearFavoritesTimeout();
    if (!loadedFavorites) {
      log.warn(`Favorite layouts took longer than ${FAVORITES_TIMEOUT_MS}ms to load, continuing`);
    }
    // Retrieve the selected layout id from the user's profile. If there's no layout specified
    // or we can't load it then save and select a default layout
    const layout = currentLayoutId
      ? layouts.find((element) => element.id === currentLayoutId)
      : undefined;

    // A favorite is what the app opens with, but a reload keeps the layout that was shown (e.g. a
    // sample's own layout).
    const favoriteLayout = findFavoriteLayout(layouts, loadedFavorites ?? layoutManager.favorites);
    if (favoriteLayout && !(layout && isPageReload())) {
      await selectInitial(favoriteLayout.id, { saveToProfile: false });
      return;
    }

    if (layout) {
      await selectInitial(layout.id, { saveToProfile: false });
      return;
    }

    if (layouts.length > 0) {
      const orgLayouts = layouts.filter((l) => l.permission.startsWith(ORG_PERMISSION_PREFIX));
      const layoutsToSort = orgLayouts.length > 0 ? orgLayouts : layouts;
      const sortedLayouts = [...layoutsToSort].sort((a, b) => a.name.localeCompare(b.name));
      await selectInitial(sortedLayouts[0]!.id);
      return;
    }

    if (selectionSeq.current !== startSeq) {
      return;
    }
    const defaultLayout = await layoutManager.saveNewLayout(DEFAULT_LAYOUT);
    await selectInitial(defaultLayout.id);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getUserProfile, layoutManager, setSelectedLayoutId, enqueueSnackbar]);

  const { updateSharedPanelState } = useUpdateSharedPanelState(layoutStateRef, setLayoutState);

  const actions: ICurrentLayout["actions"] = useMemo(
    () => ({
      updateSharedPanelState,
      setCurrentLayout: () => {},
      setSelectedLayoutId,
      getCurrentLayoutState: () => layoutStateRef.current,

      savePanelConfigs: (payload: SaveConfigsPayload) => {
        performAction({ type: "SAVE_PANEL_CONFIGS", payload });
      },
      updatePanelConfigs: (
        panelType: string,
        perPanelFunc: (config: PanelConfig) => PanelConfig,
      ) => {
        performAction({ type: "SAVE_FULL_PANEL_CONFIG", payload: { panelType, perPanelFunc } });
      },
      changePanelLayout: (payload: ChangePanelLayoutPayload) => {
        performAction({ type: "CHANGE_PANEL_LAYOUT", payload });
      },
      overwriteGlobalVariables: (payload: Record<string, VariableValue>) => {
        performAction({ type: "OVERWRITE_GLOBAL_DATA", payload });
      },
      setGlobalVariables: (payload: Record<string, VariableValue>) => {
        performAction({ type: "SET_GLOBAL_DATA", payload });
      },
      setUserScripts: (payload: Partial<UserScripts>) => {
        performAction({ type: "SET_USER_NODES", payload });
      },
      setPlaybackConfig: (payload: Partial<PlaybackConfig>) => {
        performAction({ type: "SET_PLAYBACK_CONFIG", payload });
      },
      closePanel: (payload: ClosePanelPayload) => {
        performAction({ type: "CLOSE_PANEL", payload });
        // Deselect the removed panel
        setSelectedPanelIds((ids) => ids.filter((id) => id !== payload.id));
      },
      splitPanel: (payload: SplitPanelPayload) => {
        performAction({ type: "SPLIT_PANEL", payload });
      },
      swapPanel: (payload: SwapPanelPayload) => {
        // Select the new panel if the original panel was selected. We don't know what
        // the new panel id will be so we diff the panelIds of the old and
        // new layout so we can select the new panel.
        const originalIsSelected = selectedPanelIds.current.includes(payload.originalId);
        const beforePanelIds = Object.keys(
          layoutStateRef.current.selectedLayout?.data?.configById ?? {},
        );
        performAction({ type: "SWAP_PANEL", payload });
        if (originalIsSelected) {
          const afterPanelIds = Object.keys(
            layoutStateRef.current.selectedLayout?.data?.configById ?? {},
          );
          setSelectedPanelIds(_.difference(afterPanelIds, beforePanelIds));
        }
      },
      addPanel: (payload: AddPanelPayload) => {
        performAction({ type: "ADD_PANEL", payload });
      },
      groupPanels: (payload: GroupPanelsPayload) => {
        performAction({ type: "GROUP_PANELS", payload });
        setSelectedPanelIds([]);
      },
      undoLayoutChange: () => {
        commitLayoutData((h, data) => h.undo(data), { externalEdit: true });
      },
      redoLayoutChange: () => {
        commitLayoutData((h, data) => h.redo(data), { externalEdit: true });
      },
      reopenClosedPanel: () => {
        commitLayoutData((h, data) => h.reopenClosedPanel(data, performance.now()));
      },
      goToLayoutHistory: (index: number) => {
        commitLayoutData((h, data) => h.goTo(data, index), { externalEdit: true });
      },
      getLayoutHistory: () => history.current.snapshot(),
      subscribeLayoutHistory: (listener: () => void) => history.current.subscribe(listener),
    }),
    [
      commitLayoutData,
      performAction,
      setSelectedLayoutId,
      setSelectedPanelIds,
      updateSharedPanelState,
    ],
  );

  const value: ICurrentLayout = useShallowMemo({
    addLayoutStateListener,
    removeLayoutStateListener,
    addSelectedPanelIdsListener,
    removeSelectedPanelIdsListener,
    getSelectedPanelIds,
    setSelectedPanelIds,
    actions,
  });

  return (
    <CurrentLayoutContext.Provider value={value}>
      {children}
      {incompatibleLayoutVersionError && (
        <IncompatibleLayoutVersionAlert
          onClose={() => {
            setIncompatibleLayoutVersionError(false);
          }}
        />
      )}
    </CurrentLayoutContext.Provider>
  );
}
