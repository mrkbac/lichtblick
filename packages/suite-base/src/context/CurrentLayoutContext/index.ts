// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useCallback } from "react";
import { getLeaves } from "react-mosaic-component";
import { StoreApi, useStore } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";

import {
  selectWithUnstableIdentityWarning,
  useGuaranteedContext,
  useShallowMemo,
} from "@lichtblick/hooks";
import Logger from "@lichtblick/log";
import { RenderState, VariableValue } from "@lichtblick/suite";
import useShouldNotChangeOften from "@lichtblick/suite-base/hooks/useShouldNotChangeOften";
import toggleSelectedPanel from "@lichtblick/suite-base/providers/CurrentLayoutProvider/toggleSelectedPanel";
import { PanelConfig, PlaybackConfig, UserScripts } from "@lichtblick/suite-base/types/panels";

import {
  AddPanelPayload,
  ChangePanelLayoutPayload,
  ClosePanelPayload,
  CreateTabPanelPayload,
  DropPanelPayload,
  EndDragPayload,
  LayoutData,
  MoveTabPayload,
  SaveConfigsPayload,
  SplitPanelPayload,
  StartDragPayload,
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
 * Encapsulates the mosaic layout, user nodes, and playback settings (everything considered to be
 * part of a saved "layout") used by the current workspace.
 */
export interface ICurrentLayout {
  layoutStore: StoreApi<LayoutState>;
  selectedPanelIdsStore: StoreApi<{ selectedPanelIds: readonly string[] }>;

  /**
   * We use the same mosaicId for all mosaics (at the top level and within tabs) to support
   * dragging and dropping between them.
   */
  mosaicId: string;

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
    createTabPanel: (payload: CreateTabPanelPayload) => void;
    changePanelLayout: (payload: ChangePanelLayoutPayload) => void;
    overwriteGlobalVariables: (payload: Record<string, VariableValue>) => void;
    setGlobalVariables: (payload: Record<string, VariableValue>) => void;
    setUserScripts: (payload: Partial<UserScripts>) => void;
    setPlaybackConfig: (payload: Partial<PlaybackConfig>) => void;
    closePanel: (payload: ClosePanelPayload) => void;
    splitPanel: (payload: SplitPanelPayload) => void;
    swapPanel: (payload: SwapPanelPayload) => void;
    moveTab: (payload: MoveTabPayload) => void;
    addPanel: (payload: AddPanelPayload) => void;
    dropPanel: (payload: DropPanelPayload) => void;
    startDrag: (payload: StartDragPayload) => void;
    endDrag: (payload: EndDragPayload) => void;
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
  togglePanelSelected: (panelId: string, containingTabId: string | undefined) => void;
};

const log = Logger.getLogger(__filename);

const CurrentLayoutContext = createContext<ICurrentLayout | undefined>(undefined);
CurrentLayoutContext.displayName = "CurrentLayoutContext";

export function usePanelMosaicId(): string {
  return useGuaranteedContext(CurrentLayoutContext).mosaicId;
}

export function useCurrentLayoutActions(): CurrentLayoutActions {
  return useGuaranteedContext(CurrentLayoutContext).actions;
}

export function useCurrentLayoutSelector<T>(selector: (layoutState: LayoutState) => T): T {
  const { layoutStore } = useGuaranteedContext(CurrentLayoutContext);

  // Catch locations using unstable function selectors
  useShouldNotChangeOften(selector, () => {
    log.warn(
      "useCurrentLayoutSelector is changing frequently. Rewrite your selector as a stable function.",
    );
  });

  // The with-equality variant only re-runs the selector when the state or the selector changes,
  // so selectors that return a fresh object for the same state don't loop.
  const select = useCallback(
    (state: LayoutState) => selectWithUnstableIdentityWarning(state, selector),
    [selector],
  );
  return useStoreWithEqualityFn(layoutStore, select);
}

const selectSelectedPanelIds = (state: { selectedPanelIds: readonly string[] }) =>
  state.selectedPanelIds;

export function useSelectedPanels(): SelectedPanelActions {
  const { selectedPanelIdsStore, setSelectedPanelIds, getSelectedPanelIds } =
    useGuaranteedContext(CurrentLayoutContext);
  const selectedPanelIds = useStore(selectedPanelIdsStore, selectSelectedPanelIds);
  const { getCurrentLayoutState: getCurrentLayout } = useCurrentLayoutActions();

  const selectAllPanels = useCallback(() => {
    const panelIds = getLeaves(getCurrentLayout().selectedLayout?.data?.layout ?? null);
    setSelectedPanelIds(panelIds);
  }, [getCurrentLayout, setSelectedPanelIds]);

  const togglePanelSelected = useCallback(
    (panelId: string, containingTabId: string | undefined) => {
      setSelectedPanelIds((selectedIds) => {
        const { selectedLayout } = getCurrentLayout();
        if (!selectedLayout?.data) {
          return selectedIds;
        }
        return toggleSelectedPanel(
          panelId,
          containingTabId,
          selectedLayout.data.configById,
          selectedIds,
        );
      });
    },
    [setSelectedPanelIds, getCurrentLayout],
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
