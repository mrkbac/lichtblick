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
import { EventsStore, useEvents } from "@lichtblick/suite-base/context/EventsContext";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { isRecordingSource } from "@lichtblick/suite-base/players/constants";
import { AppURLState, updateAppURLState } from "@lichtblick/suite-base/util/appURLState";

const selectCanSeek = (ctx: MessagePipelineContext) =>
  isRecordingSource(ctx.playerState.capabilities);
const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectSelectedEventId = (store: EventsStore) => store.selectedEventId;

function updateUrl(newState: AppURLState) {
  const newStateUrl = updateAppURLState(new URL(window.location.href), newState);
  // Never decodeURIComponent the whole href: a data-source URL with its own query string
  // (e.g. a presigned URL) would spill its `&…` params into ours and break on reload.
  // Only unescape `:`, `/` and `,`, which are literal in a query and keep times/URLs readable.
  newStateUrl.search = newStateUrl.search.replace(/%(3A|2F|2C)/gi, (m) => decodeURIComponent(m));
  window.history.replaceState(undefined, "", newStateUrl.href);
}

/**
 * Syncs our current player state and time with the URL in the address bar.
 */
export function useStateToURLSynchronization(): void {
  const playerUrlState = useMessagePipeline(selectUrlState);
  const stablePlayerUrlState = useDeepMemo(playerUrlState);
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
    const sourceId = stablePlayerUrlState.sourceId;
    const source = availableSources.find(
      (candidate) => candidate.id === sourceId || candidate.legacyIds?.includes(sourceId) === true,
    );
    if (source?.type === "file") {
      updateUrl({ ds: undefined, dsParams: {} });
      return;
    }

    updateUrl({
      ds: stablePlayerUrlState.sourceId,
      dsParams: _.pickBy(
        {
          ...stablePlayerUrlState.parameters,
          eventId: selectedEventId,
        },
        _.isString,
      ),
      dsParamsArray: _.pickBy(
        stablePlayerUrlState.parameters,

        _.isArray,
      ),
    });
  }, [availableSources, selectedEventId, stablePlayerUrlState]);
}
