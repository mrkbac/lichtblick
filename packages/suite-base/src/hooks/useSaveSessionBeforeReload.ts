// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect } from "react";

import { LAYOUT_SAVE_MAX_WAIT_MS } from "@lichtblick/suite-base/components/CurrentLayoutLocalStorageSyncAdapter";
import { useMessagePipelineGetter } from "@lichtblick/suite-base/components/MessagePipeline";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import {
  rememberPlaybackForReload,
  setSaveSessionBeforeReload,
} from "@lichtblick/suite-base/hooks/useServiceWorkerUpdate";
import { updateUrl } from "@lichtblick/suite-base/hooks/useStateToURLSynchronization";
import { isRecordingSource } from "@lichtblick/suite-base/players/constants";
import delay from "@lichtblick/suite-base/util/delay";

/** An update must never hang on a stuck save */
const MAX_SAVE_WAIT_MS = 3000;

/**
 * Before an update reloads this window, save what the reload would otherwise lose: the last layout
 * edit (debounced, then written asynchronously), the exact playback time (the URL lags by up to
 * half a second) and whether the recording was playing (recordings open paused).
 */
export function useSaveSessionBeforeReload(): void {
  const getMessagePipeline = useMessagePipelineGetter();
  const layoutManager = useLayoutManager();

  useEffect(
    () =>
      setSaveSessionBeforeReload(async () => {
        const deadline = Date.now() + MAX_SAVE_WAIT_MS;
        await delay(LAYOUT_SAVE_MAX_WAIT_MS + 50);
        while (layoutManager.isBusy() && Date.now() < deadline) {
          await delay(50);
        }
        // read last: playback kept going while the layout saved
        const { playerState } = getMessagePipeline();
        const activeData = playerState.activeData;
        if (activeData && isRecordingSource(playerState.capabilities)) {
          updateUrl({ time: activeData.currentTime });
          rememberPlaybackForReload({ playing: activeData.isPlaying });
        }
      }),
    [getMessagePipeline, layoutManager],
  );
}
