// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { createContext, useCallback, useLayoutEffect, useReducer, useRef, useState } from "react";

import {
  selectWithUnstableIdentityWarning,
  useGuaranteedContext,
  useShallowMemo,
} from "@lichtblick/hooks";
import Logger from "@lichtblick/log";
import { RenderState, VariableValue } from "@lichtblick/suite";
import useShouldNotChangeOften from "@lichtblick/suite-base/hooks/useShouldNotChangeOften";
import { PanelConfig, PlaybackConfig, UserScripts } from "@lichtblick/suite-base/types/panels";
import { getAllPanelIds } from "@lichtblick/suite-base/util/tabLayout";

import {
  AddPanelPayload,
  ChangePanelLayoutPayload,
  ClosePanelPayload,
  GroupPanelsPayload,
  LayoutData,
  SaveConfigsPayload,
  SplitPanelPayload,
  SwapPanelPayload,
} from "./actions";

type PanelType = string;

export type { LayoutData };

export type SharedPanelState = RenderState["sharedPanelState"];

export type UpdatePanelState = (type: PanelType, data: SharedPanelState) => void;

export type SelectedLayout = {
  data: LayoutData | undefined;
  name?: string;
  edited?: boolean;
};
export type LayoutID = string & { __brand: "LayoutID" };

export type LayoutState = Readonly<{
  /**
   * Transient state shared between panels, keyed by panel type.
   */
  sharedPanelState?: Record<PanelType, SharedPanelState>;

  selectedLayout:
    | {
        id: LayoutID;
        loading?: boolean;
        data: LayoutData | undefined;
        name?: string;
        edited?: boolean;
      }
    | undefined;
}>;

/**
 * Encapsulates the panel layout, user nodes, and playback settings (everything considered to be
 * part of a saved "layout") used by the current workspace.
 */
export interface ICurrentLayout {
  addLayoutStateListener: (listener: (_: LayoutState) => void) => void;
  removeLayoutStateListener: (listener: (_: LayoutState) => void) => void;
  addSelectedPanelIdsListener: (listener: (_: readonly string[]) => void) => void;
  removeSelectedPanelIdsListener: (listener: (_: readonly string[]) => void) => void;

  getSelectedPanelIds: () => readonly string[];
  setSelectedPanelIds: (
    _: readonly string[] | ((prevState: readonly string[]) => readonly string[]),
  ) => void;

  actions: {
    /**
     * Returns the current state - useful for click handlers and callbacks that read the state
     * asynchronously and don't want to update every time the state changes.
     */
    getCurrentLayoutState: () => LayoutState;
    setSelectedLayoutId: (id: LayoutID | undefined) => void;

    /**
     * Update the transient state associated with a particular panel type.
     */
    updateSharedPanelState: UpdatePanelState;

    savePanelConfigs: (payload: SaveConfigsPayload) => void;
    updatePanelConfigs: (panelType: string, updater: (config: PanelConfig) => PanelConfig) => void;
    changePanelLayout: (payload: ChangePanelLayoutPayload) => void;
    overwriteGlobalVariables: (payload: Record<string, VariableValue>) => void;
    setGlobalVariables: (payload: Record<string, VariableValue>) => void;
    setUserScripts: (payload: Partial<UserScripts>) => void;
    setPlaybackConfig: (payload: Partial<PlaybackConfig>) => void;
    closePanel: (payload: ClosePanelPayload) => void;
    splitPanel: (payload: SplitPanelPayload) => void;
    swapPanel: (payload: SwapPanelPayload) => void;
    addPanel: (payload: AddPanelPayload) => void;
    groupPanels: (payload: GroupPanelsPayload) => void;
    /** Steps back through layout edits of the current layout. */
    undoLayoutChange: () => void;
    redoLayoutChange: () => void;
    /** Puts the most recently closed panel back, with its config. */
    reopenClosedPanel: () => void;
  };
}

export type CurrentLayoutActions = ICurrentLayout["actions"];

export type SelectedPanelActions = {
  getSelectedPanelIds: () => readonly string[];
  selectedPanelIds: readonly string[];
  setSelectedPanelIds: (
    _: readonly string[] | ((prevState: readonly string[]) => string[]),
  ) => void;
  selectAllPanels: () => void;
  togglePanelSelected: (panelId: string) => void;
};

const log = Logger.getLogger(__filename);

const CurrentLayoutContext = createContext<ICurrentLayout | undefined>(undefined);
CurrentLayoutContext.displayName = "CurrentLayoutContext";

export function useCurrentLayoutActions(): CurrentLayoutActions {
  return useGuaranteedContext(CurrentLayoutContext).actions;
}

export function useCurrentLayoutSelector<T>(selector: (layoutState: LayoutState) => T): T {
  const currentLayout = useGuaranteedContext(CurrentLayoutContext);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // Catch locations using unstable function selectors
  useShouldNotChangeOften(selector, () => {
    log.warn(
      "useCurrentLayoutSelector is changing frequently. Rewrite your selector as a stable function.",
    );
  });

  const state = useRef<{ value: T; selector: typeof selector } | undefined>(undefined);
  if (selector !== state.current?.selector) {
    state.current = {
      value: selectWithUnstableIdentityWarning(
        currentLayout.actions.getCurrentLayoutState(),
        selector,
      ),
      selector,
    };
  }
  useLayoutEffect(() => {
    let mounted = true;
    const listener = (layoutState: LayoutState) => {
      // Note: Our removeLayoutStateListener is is too late if the layout state listeners are already
      // being invoked. Our component might become unmounted during the state listener invocation
      if (!mounted) {
        return;
      }
      const newValue = selectWithUnstableIdentityWarning(layoutState, selector);
      if (newValue === state.current?.value) {
        return;
      }
      state.current = {
        value: newValue,
        selector,
      };
      forceUpdate();
    };
    // Update if necessary, i.e. if the state has changed between render and this effect
    listener(currentLayout.actions.getCurrentLayoutState());
    currentLayout.addLayoutStateListener(listener);
    return () => {
      mounted = false;
      currentLayout.removeLayoutStateListener(listener);
    };
  }, [currentLayout, selector]);

  return state.current.value;
}

export function useSelectedPanels(): SelectedPanelActions {
  const currentLayout = useGuaranteedContext(CurrentLayoutContext);
  const [selectedPanelIds, setSelectedPanelIdsState] = useState(() =>
    currentLayout.getSelectedPanelIds(),
  );
  useLayoutEffect(() => {
    const listener = (newIds: readonly string[]) => {
      setSelectedPanelIdsState(newIds);
    };
    currentLayout.addSelectedPanelIdsListener(listener);
    return () => {
      currentLayout.removeSelectedPanelIdsListener(listener);
    };
  }, [currentLayout]);

  const setSelectedPanelIds = useGuaranteedContext(CurrentLayoutContext).setSelectedPanelIds;
  const getSelectedPanelIds = useGuaranteedContext(CurrentLayoutContext).getSelectedPanelIds;
  const { getCurrentLayoutState: getCurrentLayout } = useCurrentLayoutActions();

  const selectAllPanels = useCallback(() => {
    const data = getCurrentLayout().selectedLayout?.data;
    const panelIds = data ? getAllPanelIds(data) : [];
    setSelectedPanelIds(panelIds);
  }, [getCurrentLayout, setSelectedPanelIds]);

  const togglePanelSelected = useCallback(
    (panelId: string) => {
      setSelectedPanelIds((selectedIds) => _.xor(selectedIds, [panelId]));
    },
    [setSelectedPanelIds],
  );

  return useShallowMemo({
    getSelectedPanelIds,
    selectedPanelIds,
    setSelectedPanelIds,
    selectAllPanels,
    togglePanelSelected,
  });
}

export default CurrentLayoutContext;
