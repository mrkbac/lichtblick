// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useMemo, useState } from "react";
import { createStore } from "zustand";

import { useShallowMemo } from "@lichtblick/hooks";
import CurrentLayoutContext, {
  ICurrentLayout,
  LayoutID,
  LayoutState,
  SelectedLayout,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import {
  LayoutData,
  PanelsActions,
} from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import panelsReducer, {
  defaultPlaybackConfig,
} from "@lichtblick/suite-base/providers/CurrentLayoutProvider/reducers";

/**
 * An alternative implementation of CurrentLayoutProvider, for use in tests, which performs actions
 * synchronously and doesn't require a LayoutManager.
 */
export default function MockCurrentLayoutProvider({
  children,
  initialState,
  onAction,
}: React.PropsWithChildren<{
  initialState?: Partial<LayoutData>;
  onAction?: (action: PanelsActions) => void;
}>): React.JSX.Element {
  const [layoutStore] = useState(() =>
    createStore<LayoutState>(() => ({
      selectedLayout: {
        id: "mock-layout" as LayoutID,
        data: {
          configById: {},
          globalVariables: {},
          userNodes: {},
          playbackConfig: defaultPlaybackConfig,
          ...initialState,
        },
      },
    })),
  );
  const [selectedPanelIdsStore] = useState(() =>
    createStore<{ selectedPanelIds: readonly string[] }>(() => ({ selectedPanelIds: [] })),
  );
  const setLayoutState = useCallback(
    (newState: LayoutState) => {
      layoutStore.setState(newState, true);
    },
    [layoutStore],
  );

  const setCurrentLayout = useCallback(
    (newLayout: SelectedLayout | undefined) => {
      setLayoutState({
        selectedLayout: {
          data: newLayout?.data,
          id: "mock-id" as LayoutID,
          edited: newLayout?.edited,
          name: newLayout?.name,
        },
      });
    },
    [setLayoutState],
  );

  const updateSharedPanelState = useCallback<ICurrentLayout["actions"]["updateSharedPanelState"]>(
    (type, newSharedState) => {
      setLayoutState({
        ...layoutStore.getState(),
        sharedPanelState: { ...layoutStore.getState().sharedPanelState, [type]: newSharedState },
      });
    },
    [layoutStore, setLayoutState],
  );

  const performAction = useCallback(
    (action: PanelsActions) => {
      onAction?.(action);
      const state = layoutStore.getState();
      setLayoutState({
        ...state,
        selectedLayout: {
          ...state.selectedLayout,
          id: state.selectedLayout?.id ?? ("mock-id" as LayoutID),
          data: state.selectedLayout?.data
            ? panelsReducer(state.selectedLayout.data, action)
            : undefined,
        },
      });
    },
    [layoutStore, onAction, setLayoutState],
  );

  const actions: ICurrentLayout["actions"] = useMemo(
    () => ({
      setSelectedLayoutId: () => {
        throw new Error("Not implemented in MockCurrentLayoutProvider");
      },
      getCurrentLayoutState: () => layoutStore.getState(),

      setCurrentLayout,
      updateSharedPanelState,

      savePanelConfigs: (payload) => {
        performAction({ type: "SAVE_PANEL_CONFIGS", payload });
      },
      updatePanelConfigs: (panelType, perPanelFunc) => {
        performAction({ type: "SAVE_FULL_PANEL_CONFIG", payload: { panelType, perPanelFunc } });
      },
      createTabPanel: (payload) => {
        performAction({ type: "CREATE_TAB_PANEL", payload });
      },
      changePanelLayout: (payload) => {
        performAction({ type: "CHANGE_PANEL_LAYOUT", payload });
      },
      overwriteGlobalVariables: (payload) => {
        performAction({ type: "OVERWRITE_GLOBAL_DATA", payload });
      },
      setGlobalVariables: (payload) => {
        performAction({ type: "SET_GLOBAL_DATA", payload });
      },
      setUserScripts: (payload) => {
        performAction({ type: "SET_USER_NODES", payload });
      },
      setPlaybackConfig: (payload) => {
        performAction({ type: "SET_PLAYBACK_CONFIG", payload });
      },
      closePanel: (payload) => {
        performAction({ type: "CLOSE_PANEL", payload });
      },
      splitPanel: (payload) => {
        performAction({ type: "SPLIT_PANEL", payload });
      },
      swapPanel: (payload) => {
        performAction({ type: "SWAP_PANEL", payload });
      },
      moveTab: (payload) => {
        performAction({ type: "MOVE_TAB", payload });
      },
      addPanel: (payload) => {
        performAction({ type: "ADD_PANEL", payload });
      },
      dropPanel: (payload) => {
        performAction({ type: "DROP_PANEL", payload });
      },
      startDrag: (payload) => {
        performAction({ type: "START_DRAG", payload });
      },
      endDrag: (payload) => {
        performAction({ type: "END_DRAG", payload });
      },
    }),
    [layoutStore, performAction, setCurrentLayout, updateSharedPanelState],
  );

  const value: ICurrentLayout = useShallowMemo({
    layoutStore,
    selectedPanelIdsStore,
    mosaicId: "mockMosaicId",
    getSelectedPanelIds: useCallback(() => [], []),
    setSelectedPanelIds: useCallback(() => {
      // no-op
    }, []),
    actions,
  });
  return <CurrentLayoutContext.Provider value={value}>{children}</CurrentLayoutContext.Provider>;
}
