// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect } from "react";

import { flushPendingLayoutSave } from "@lichtblick/suite-base/components/CurrentLayoutLocalStorageSyncAdapter";
import { useMessagePipelineGetter } from "@lichtblick/suite-base/components/MessagePipeline";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import {
  playerSourceKey,
  setSaveSessionBeforeReload,
} from "@lichtblick/suite-base/hooks/useServiceWorkerUpdate";
import { updateUrl } from "@lichtblick/suite-base/hooks/useStateToURLSynchronization";
import { isRecordingSource } from "@lichtblick/suite-base/players/constants";
import type { ILayoutManager } from "@lichtblick/suite-base/services/ILayoutManager";

/** An update must never hang on a stuck save */
const MAX_SAVE_WAIT_MS = 3000;
/** A flushed edit that starts no write (e.g. the first one after a layout loads) can't hold it up */
const MAX_WRITE_START_MS = 1000;

/**
 * Resolves once `done()` holds, checked on each busy change, or after `timeoutMs`. Event-driven:
 * timers in a background tab are throttled to a second or more, which would stall the reload.
 */
async function waitForLayoutManager(
  layoutManager: ILayoutManager,
  isDone: () => boolean,
  timeoutMs: number,
): Promise<void> {
  if (isDone() || timeoutMs <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      layoutManager.off("busychange", onChange);
      resolve();
    };
    const onChange = () => {
      if (isDone()) {
        done();
      }
    };
    const timer = setTimeout(done, timeoutMs);
    layoutManager.on("busychange", onChange);
  });
}

/**
 * Before an update reloads this window, save what the reload would otherwise lose: the last layout
 * edit (debounced, then written asynchronously), the exact playback time (the URL lags by up to
 * half a second) and which recording was playing (recordings open paused).
 */
export function useSaveSessionBeforeReload(): void {
  const getMessagePipeline = useMessagePipelineGetter();
  const layoutManager = useLayoutManager();

  useEffect(
    () =>
      setSaveSessionBeforeReload(async () => {
        const deadline = Date.now() + MAX_SAVE_WAIT_MS;
        // No fixed wait for the debounce: timers in a background tab run late
        if (flushPendingLayoutSave()) {
          await waitForLayoutManager(
            layoutManager,
            () => layoutManager.isBusy(),
            MAX_WRITE_START_MS,
          );
        }
        await waitForLayoutManager(
          layoutManager,
          () => !layoutManager.isBusy(),
          deadline - Date.now(),
        );
        // read last: playback kept going while the layout saved
        const { playerState } = getMessagePipeline();
        const activeData = playerState.activeData;
        if (!activeData || !isRecordingSource(playerState.capabilities)) {
          return undefined;
        }
        updateUrl({ time: activeData.currentTime });
        // stored right before the reload, see reloadPage
        return activeData.isPlaying ? playerSourceKey(playerState) : undefined;
      }),
    [getMessagePipeline, layoutManager],
  );
}
