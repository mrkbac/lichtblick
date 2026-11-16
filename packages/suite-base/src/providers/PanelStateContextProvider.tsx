// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PropsWithChildren, useCallback, useEffect, useState } from "react";
import { StoreApi, createStore } from "zustand";

import { Immutable } from "@lichtblick/suite";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import {
  ImmutableSettingsTree,
  PanelStateContext,
  PanelStateStore,
  usePanelStateStore,
} from "@lichtblick/suite-base/context/PanelStateContext";
import type { DocumentedSettingsTree } from "@lichtblick/suite-base/panels/shared/documentedSettings";

function createPanelStateStore(initialState?: Partial<PanelStateStore>): StoreApi<PanelStateStore> {
  return createStore((set) => {
    return {
      sequenceNumbers: {},
      settingsTrees: {},
      defaultTitles: {},

      incrementSequenceNumber: (panelId: string) => {
        set((state) => {
          return {
            sequenceNumbers: {
              ...state.sequenceNumbers,
              [panelId]: (state.sequenceNumbers[panelId] ?? 0) + 1,
            },
          };
        });
      },

      updateSettingsTree: (panelId, settingsTree) => {
        set((state) => ({
          settingsTrees: {
            ...state.settingsTrees,
            [panelId]: settingsTree,
          },
        }));
      },

      updateDefaultTitle: (panelId, defaultTitle) => {
        set((state) => ({ defaultTitles: { ...state.defaultTitles, [panelId]: defaultTitle } }));
      },

      ...initialState,
    };
  });
}

const updateSettingsTreeSelector = (store: PanelStateStore) => store.updateSettingsTree;

/**
 * Returns the updater for the current panel's settings tree. Built-in panels must document every
 * field (see {@link DocumentedSettingsTree}); extension panels go through
 * {@link useUncheckedPanelSettingsTreeUpdate}.
 */
export function usePanelSettingsTreeUpdate(): (newTree: Immutable<DocumentedSettingsTree>) => void {
  return useUncheckedPanelSettingsTreeUpdate();
}

/** Like {@link usePanelSettingsTreeUpdate}, for trees from extensions, whose fields may lack help. */
export function useUncheckedPanelSettingsTreeUpdate(): (newTree: ImmutableSettingsTree) => void {
  const { id } = usePanelContext();
  const updateStoreTree = usePanelStateStore(updateSettingsTreeSelector);

  const updateSettingsTree = useCallback(
    (newTree: ImmutableSettingsTree) => {
      updateStoreTree(id, newTree);
    },
    [id, updateStoreTree],
  );

  /** Cleanup unmounted panels
   * `actionHandler` can capture panel variables in closure context and keep them in memory
   * even after unmounting. To prevent this we set the panelSettingsTree entry to undefined,
   * allowing the actionHandler and its captured closure context from the unmounted panel to
   * be garbage collected.
   */
  useEffect(() => {
    return () => {
      updateStoreTree(id, undefined);
    };
  }, [id, updateStoreTree]);

  return updateSettingsTree;
}

const updateDefaultTitleSelector = (store: PanelStateStore) => store.updateDefaultTitle;

/**
 * Returns a [state, setState] pair that can be used to read and update a panel's default title.
 */
export function useDefaultPanelTitle(): [
  string | undefined,
  (defaultTitle: string | undefined) => void,
] {
  const panelId = usePanelContext().id;

  const selector = useCallback((store: PanelStateStore) => store.defaultTitles[panelId], [panelId]);

  const updateDefaultTitle = usePanelStateStore(updateDefaultTitleSelector);
  const defaultTitle = usePanelStateStore(selector);
  const update = useCallback(
    (newValue: string | undefined) => {
      updateDefaultTitle(panelId, newValue);
    },
    [panelId, updateDefaultTitle],
  );

  return [defaultTitle, update];
}

type Props = PropsWithChildren<{
  initialState?: Partial<PanelStateStore>;
}>;

export function PanelStateContextProvider(props: Props): React.JSX.Element {
  const { children, initialState } = props;

  const [store] = useState(() => createPanelStateStore(initialState));

  return <PanelStateContext.Provider value={store}>{children}</PanelStateContext.Provider>;
}
