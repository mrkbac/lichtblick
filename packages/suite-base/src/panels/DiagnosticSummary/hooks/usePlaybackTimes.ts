// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useState } from "react";

import { areEqual, Time } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";

export type PlaybackTimes = { start?: Time; end?: Time; current?: Time };

const DEFAULT_UPDATE_INTERVAL_MS = 250;

const selectLastSeekTime = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.lastSeekTime;

const same = (a?: Time, b?: Time) => (a && b ? areEqual(a, b) : a === b);
const isSame = (a: PlaybackTimes, b: PlaybackTimes) =>
  same(a.start, b.start) && same(a.end, b.end) && same(a.current, b.current);

/**
 * Data source start/end and current playback time, polled at a fixed rate (and on seek) instead
 * of on every frame so panels with hundreds of rows don't re-render at playback rate.
 */
export default function usePlaybackTimes(updateIntervalMillis?: number): PlaybackTimes {
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

  useEffect(() => {
    const interval = setInterval(update, updateIntervalMillis ?? DEFAULT_UPDATE_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [update, updateIntervalMillis]);

  const lastSeekTime = useMessagePipeline(selectLastSeekTime);
  useEffect(update, [update, lastSeekTime]);

  return times;
}
