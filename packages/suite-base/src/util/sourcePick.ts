// SPDX-License-Identifier: MPL-2.0

import { create } from "zustand";

import type { DataSourceArgs } from "@lichtblick/suite-base/context/PlayerSelectionContext";

/**
 * A pending "pick a recording" request, e.g. the compare dialog adding a row from recents, a URL or
 * the catalog. While set, the next source the user opens anywhere is handed to `deliver` instead of
 * replacing the open data source, so every way of opening a source works for it.
 */
export type SourcePick = {
  /** What the pick is for, shown while picking, e.g. "recording B" */
  label: string;
  deliver: (sourceId: string, args?: DataSourceArgs) => void;
};

export const useSourcePick = create<{ pick?: SourcePick }>()(() => ({}));

/** Hands an opened source to the pending pick, if any, and ends the pick; true when it did */
export function takeSourcePick(sourceId: string, args?: DataSourceArgs): boolean {
  const { pick } = useSourcePick.getState();
  if (!pick) {
    return false;
  }
  useSourcePick.setState({ pick: undefined });
  pick.deliver(sourceId, args);
  return true;
}
