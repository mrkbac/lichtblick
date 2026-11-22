// SPDX-License-Identifier: MPL-2.0

// The compare dialog's state and openers, kept apart from the dialog itself so menus can open it
// without loading the dialog at startup.

import { useCallback } from "react";
import { create } from "zustand";

import {
  IDataSourceFactory,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import {
  CompareDraft,
  Recording,
  draftFromFiles,
  recordingExtension,
} from "@lichtblick/suite-base/util/compareSides";

/**
 * The source that compares `recordings` (local files and remote URLs): a file source that compares
 * and reads every recording's type
 */
export function compareSourceFor(
  recordings: readonly Recording[],
  sources: readonly IDataSourceFactory[],
): IDataSourceFactory | undefined {
  return sources.find(
    (source) =>
      source.type === "file" &&
      source.supportsCompare === true &&
      recordings.every((r) => source.supportedFileTypes?.includes(recordingExtension(r)) === true),
  );
}

/** The open compare dialog's starting draft, so menus anywhere can open it */
export const useCompareDialog = create<{
  draft: CompareDraft | undefined;
  show: (draft: CompareDraft) => void;
  hide: () => void;
}>()((set) => ({
  draft: undefined,
  show: (draft) => {
    set({ draft });
  },
  hide: () => {
    set({ draft: undefined });
  },
}));

/** Opens the compare dialog with the files open now, so adding recordings starts from them */
export function useShowCompareDialog(): () => void {
  const { selectedRecordings, selectedCompare, selectedWithCookies } = usePlayerSelection();
  const show = useCompareDialog((state) => state.show);
  return useCallback(() => {
    const recordings = selectedRecordings ?? [];
    show({
      ...draftFromFiles(recordings, selectedCompare),
      withCookies:
        selectedWithCookies === true ? recordings.filter((r) => typeof r === "string") : [],
    });
  }, [selectedRecordings, selectedCompare, selectedWithCookies, show]);
}
