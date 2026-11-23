// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useRef } from "react";
import { useDebouncedCallback } from "use-debounce";

import Log from "@lichtblick/log";
import { LOCAL_STORAGE_STUDIO_LAYOUT_KEY } from "@lichtblick/suite-base/constants/browserStorageKeys";
import {
  LayoutData,
  LayoutID,
  LayoutState,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";

export function selectLayoutData(state: LayoutState): LayoutData | undefined {
  return state.selectedLayout?.data;
}

export function selectLayoutId(state: LayoutState): LayoutID | undefined {
  return state.selectedLayout?.id;
}

function selectLayoutLoading(state: LayoutState): boolean | undefined {
  return state.selectedLayout?.loading;
}

type OwnedLayout = { id: LayoutID; data: LayoutData };

function storeLayoutData(data: LayoutData): void {
  const serialized = JSON.stringify(data);
  if (serialized == undefined) {
    throw new Error("Failed to serialize layout data");
  }
  localStorage.setItem(LOCAL_STORAGE_STUDIO_LAYOUT_KEY, serialized);
}

const log = Log.getLogger(__filename);

/** Layout edits reach storage at most this long after they happen. */
const LAYOUT_SAVE_MAX_WAIT_MS = 500;

let flushDebouncedLayout: (() => boolean) | undefined;

/**
 * Starts saving a debounced layout edit now instead of after the debounce (see
 * useSaveSessionBeforeReload). Returns whether an edit was pending. Its write is async:
 * LayoutManager.isBusy() reports it.
 */
export function flushPendingLayoutSave(): boolean {
  return flushDebouncedLayout?.() ?? false;
}

export function CurrentLayoutLocalStorageSyncAdapter(): React.JSX.Element {
  const currentLayoutData = useCurrentLayoutSelector(selectLayoutData);
  const currentLayoutId = useCurrentLayoutSelector(selectLayoutId);
  const loading = useCurrentLayoutSelector(selectLayoutLoading);

  const layoutManager = useLayoutManager();

  // The data together with the layout it belongs to. While a layout loads, the state shows the new
  // id with the previous layout's data, so keep the last loaded pair until loading ends.
  const owned = useRef<OwnedLayout | undefined>(undefined);
  if (
    loading !== true &&
    (owned.current?.id !== currentLayoutId || owned.current?.data !== currentLayoutData)
  ) {
    owned.current =
      currentLayoutId != undefined && currentLayoutData != undefined
        ? { id: currentLayoutId, data: currentLayoutData }
        : undefined;
  }
  const layout = owned.current;

  /** A just-selected layout: its first save is the load (plus panel setup), not an edit. */
  const skipSaveFor = useRef<LayoutID | undefined>(undefined);

  const save = useDebouncedCallback(
    async ({ id, data }: OwnedLayout) => {
      storeLayoutData(data);
      if (skipSaveFor.current === id) {
        skipSaveFor.current = undefined;
        return;
      }
      try {
        // Only the data (panel configuration), saved to the 'working' copy so the layout shows
        // as edited. Renames go through layoutManager.updateLayout separately.
        await layoutManager.updateLayout({ id, data });
      } catch (error) {
        log.error(error);
      }
    },
    250,
    { maxWait: LAYOUT_SAVE_MAX_WAIT_MS },
  );

  useEffect(() => {
    const flush = () => {
      const pending = save.isPending();
      void save.flush();
      return pending;
    };
    flushDebouncedLayout = flush;
    return () => {
      if (flushDebouncedLayout === flush) {
        flushDebouncedLayout = undefined;
      }
    };
  }, [save]);

  const prevId = useRef<LayoutID | undefined>(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      // The layout present on mount is already stored.
      mounted.current = true;
      prevId.current = layout?.id;
      if (layout) {
        storeLayoutData(layout.data);
      }
      return;
    }
    if (layout?.id !== prevId.current) {
      // Save the previous layout's pending edit to that layout before switching.
      void save.flush();
      prevId.current = layout?.id;
      skipSaveFor.current = layout?.id;
    }
    if (layout) {
      void save(layout);
    }
  }, [layout, save]);

  return <></>;
}
