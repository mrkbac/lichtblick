// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { enqueueSnackbar } from "notistack";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import Log from "@lichtblick/log";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { EventsStore, useEvents } from "@lichtblick/suite-base/context/EventsContext";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import {
  isLocalFileSource,
  sourceURLState,
} from "@lichtblick/suite-base/hooks/useStateToURLSynchronization";
import { isRecordingSource } from "@lichtblick/suite-base/players/constants";
import clipboard from "@lichtblick/suite-base/util/clipboard";
import { buildShareLink, encodeSharedLayout } from "@lichtblick/suite-base/util/shareLink";

const log = Log.getLogger(__filename);

const selectSourceId = (ctx: MessagePipelineContext) => ctx.playerState.urlState?.sourceId;
const selectSelectedEventId = (store: EventsStore) => store.selectedEventId;

/**
 * - `none`: nothing to share (no source, or the app isn't served over http, e.g. desktop)
 * - `local`: the source is local files, which a link can't reopen
 * - `link`: copyLink copies a working link
 */
export type ShareLinkAvailability = "none" | "local" | "link";

/** Copies a link that reopens the current source at the current time with the current layout. */
export function useShareLink(): {
  availability: ShareLinkAvailability;
  copyLink: () => Promise<void>;
} {
  const { t } = useTranslation("general");
  const sourceId = useMessagePipeline(selectSourceId);
  const { availableSources } = usePlayerSelection();
  const getPipeline = useMessagePipelineGetter();
  const { getCurrentLayoutState } = useCurrentLayoutActions();
  const selectedEventId = useEvents(selectSelectedEventId);

  const availability: ShareLinkAvailability =
    sourceId == undefined || !/^https?:$/.test(window.location.protocol)
      ? "none"
      : isLocalFileSource(sourceId, availableSources)
        ? "local"
        : "link";

  const copyLink = useCallback(async () => {
    if (availability === "local") {
      enqueueSnackbar(t("shareLinkLocalFiles"), { variant: "info" });
      return;
    }
    if (availability === "none") {
      return;
    }
    const { playerState } = getPipeline();
    if (playerState.urlState == undefined) {
      return;
    }
    // The address bar's time lags playback; take the time right now. Live sources have none.
    const time = isRecordingSource(playerState.capabilities)
      ? playerState.activeData?.currentTime
      : undefined;
    const layoutData = getCurrentLayoutState().selectedLayout?.data;
    let encodedLayout: string | undefined;
    try {
      encodedLayout = layoutData ? await encodeSharedLayout(layoutData) : undefined;
    } catch (err: unknown) {
      log.warn("Could not encode the layout for a share link", err);
    }
    const { link, layoutIncluded } = buildShareLink(
      window.location.href,
      { ...sourceURLState(playerState.urlState, selectedEventId), time },
      encodedLayout,
    );
    try {
      await clipboard.copy(link);
    } catch (err: unknown) {
      log.error(err);
      enqueueSnackbar(t("shareLinkCopyFailed"), { variant: "error" });
      return;
    }
    enqueueSnackbar(
      layoutIncluded || !layoutData ? t("shareLinkCopied") : t("shareLinkCopiedWithoutLayout"),
      { variant: layoutIncluded || !layoutData ? "success" : "warning" },
    );
  }, [availability, getCurrentLayoutState, getPipeline, selectedEventId, t]);

  return { availability, copyLink };
}
