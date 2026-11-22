// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useEffect } from "react";
import { useDebounce } from "use-debounce";

import { useDeepMemo } from "@lichtblick/hooks";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { selectCurrentTime } from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { EventsStore, useEvents } from "@lichtblick/suite-base/context/EventsContext";
import {
  IDataSourceFactory,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { isRecordingSource } from "@lichtblick/suite-base/players/constants";
import { CompareSide, PlayerURLState } from "@lichtblick/suite-base/players/types";
import {
  AppURLState,
  readableHref,
  updateAppURLState,
} from "@lichtblick/suite-base/util/appURLState";

const selectCanSeek = (ctx: MessagePipelineContext) =>
  isRecordingSource(ctx.playerState.capabilities);
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectCompareSides = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.compareSides;
const selectSelectedEventId = (store: EventsStore) => store.selectedEventId;

/** Writes app state into the address bar without adding a history entry. */
export function updateUrl(newState: AppURLState): void {
  const newStateUrl = updateAppURLState(new URL(window.location.href), newState);
  window.history.replaceState(undefined, "", readableHref(newStateUrl));
}

/** Whether the source opens local files, which a URL can't reopen. */
export function isLocalFileSource(
  sourceId: string,
  availableSources: readonly IDataSourceFactory[],
): boolean {
  const source = availableSources.find(
    (candidate) => candidate.id === sourceId || candidate.legacyIds?.includes(sourceId) === true,
  );
  return source?.type === "file";
}

/** The URL params that reopen a player's source, with the selected event if any. */
export function sourceURLState(
  urlState: PlayerURLState,
  selectedEventId: string | undefined,
  compareSides?: readonly CompareSide[],
): AppURLState {
  const parameters: Record<string, string | string[] | undefined> = {
    ...urlState.parameters,
    eventId: selectedEventId,
  };
  if (urlState.sourceId === "remote-file" && compareSides != undefined) {
    const offsets = compareSides.map((side) => side.offsetSec);
    parameters.compareOffsets = offsets.some((offset) => offset !== 0) ? offsets.join() : undefined;
  }
  return {
    ds: urlState.sourceId,
    dsParams: _.pickBy(parameters, _.isString),
    dsParamsArray: _.pickBy(urlState.parameters, _.isArray),
  };
}

/**
 * Syncs our current player state and time with the URL in the address bar.
 */
export function useStateToURLSynchronization(): void {
  const playerUrlState = useMessagePipeline(selectUrlState);
  const stablePlayerUrlState = useDeepMemo(playerUrlState);
  const compareSides = useMessagePipeline(selectCompareSides);
  const canSeek = useMessagePipeline(selectCanSeek);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const [debouncedCurrentTime] = useDebounce(currentTime, 500, {
    maxWait: 500,
  });
  const selectedEventId = useEvents(selectSelectedEventId);
  const { availableSources } = usePlayerSelection();

  // Sync current time with the url. Until a player reports its time (no player yet on page load, or
  // a recording still loading), keep the time from the URL: Workspace seeks to it once it can.
  // Closing a source clears it (PlayerManager).
  const hasPlayer = playerUrlState != undefined;
  useEffect(() => {
    if (!hasPlayer || (canSeek && debouncedCurrentTime == undefined)) {
      return;
    }
    updateUrl({
      time: canSeek ? debouncedCurrentTime : undefined,
    });
  }, [canSeek, debouncedCurrentTime, hasPlayer]);

  // Sync player state with the url.
  // When an mcap-bundle lookup key is present, skip writing ds/dsParams to avoid URL length issues.
  useEffect(() => {
    if (stablePlayerUrlState == undefined) {
      return;
    }

    const currentUrl = new URL(globalThis.location.href);
    if (currentUrl.searchParams.get("mcap-bundle")) {
      return;
    }

    // Local files can't be reopened from the URL; a `ds` for them would only make a reload fail and
    // skip reopening the file from recents (see PlayerManager).
    if (isLocalFileSource(stablePlayerUrlState.sourceId, availableSources)) {
      updateUrl({ ds: undefined, dsParams: {} });
      return;
    }

    updateUrl(sourceURLState(stablePlayerUrlState, selectedEventId, compareSides));
  }, [availableSources, compareSides, selectedEventId, stablePlayerUrlState]);
}
