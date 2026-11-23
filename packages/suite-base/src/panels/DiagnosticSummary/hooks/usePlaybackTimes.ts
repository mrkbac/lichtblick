// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { areEqual, Time } from "@foxglove/rostime";
import { useCallback, useContext, useEffect, useState } from "react";

import { PanelVisibleContext } from "@lichtblick/suite-base/components/DockPanelContext";
import {
  useMessagePipeline,
  useMessagePipelineGetter,
  useMessagePipelineSubscribe,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { selectLastSeekTime } from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { HIDDEN_RENDER_INTERVAL_MS } from "@lichtblick/suite-base/components/PanelExtensionAdapter/hiddenFrames";

export type PlaybackTimes = { start?: Time; end?: Time; current?: Time };

const UPDATE_INTERVAL_MS = 250;

const same = (a?: Time, b?: Time) => (a && b ? areEqual(a, b) : a === b);
const isSame = (a: PlaybackTimes, b: PlaybackTimes) =>
  same(a.start, b.start) && same(a.end, b.end) && same(a.current, b.current);

/**
 * Data source start/end and current playback time, read at most once per interval (and on seek)
 * instead of on every frame so panels with hundreds of rows don't re-render at playback rate.
 * Only pipeline updates schedule a read, so nothing wakes up while playback is paused. A hidden
 * panel reads at most once per HIDDEN_RENDER_INTERVAL_MS, and right away when shown.
 */
export default function usePlaybackTimes(): PlaybackTimes {
  const messagePipeline = useMessagePipelineGetter();
  const read = useCallback((): PlaybackTimes => {
    const activeData = messagePipeline().playerState.activeData;
    return {
      start: activeData?.startTime,
      end: activeData?.endTime,
      current: activeData?.currentTime,
    };
  }, [messagePipeline]);

  const [times, setTimes] = useState<PlaybackTimes>(read);
  const update = useCallback(() => {
    const next = read();
    setTimes((prev) => (isSame(prev, next) ? prev : next));
  }, [read]);

  const visible = useContext(PanelVisibleContext);
  const intervalMs = visible ? UPDATE_INTERVAL_MS : HIDDEN_RENDER_INTERVAL_MS;
  const subscribe = useMessagePipelineSubscribe();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribe(() => {
      timer ??= setTimeout(() => {
        timer = undefined;
        update();
      }, intervalMs);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [intervalMs, subscribe, update]);

  // Right away on a seek and when shown
  const lastSeekTime = useMessagePipeline(selectLastSeekTime);
  useEffect(update, [update, lastSeekTime, visible]);

  return times;
}
