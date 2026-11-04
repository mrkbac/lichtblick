// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { compare, fromNanoSec, Time, toNanoSec } from "@foxglove/rostime";
import { useLayoutEffect } from "react";

import { useTrimStore } from "@lichtblick/suite-base/components/ExportRecordingDialog/trimStore";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";

type RepeatAdapterProps = {
  repeatEnabled: boolean;
  play: () => void;
  pause: () => void;
  seek: (to: Time) => void;
};

function activeDataSelector(ctx: MessagePipelineContext) {
  return ctx.playerState.activeData;
}

/**
 * RepeatAdapter handles looping from the start of playback when playback reaches the end, and
 * keeps playback inside the cut (trim range) when one is set.
 *
 * NOTE: Because repeat adapter receives every message pipeline frame, we isolate its logic inside
 * a separate component so it does not cause virtual DOM diffing on any children.
 */
export function RepeatAdapter(props: RepeatAdapterProps): React.JSX.Element {
  const { play, pause, seek, repeatEnabled } = props;

  const activeData = useMessagePipeline(activeDataSelector);
  const cutStart = useTrimStore((state) => state.start);
  const cutEnd = useTrimStore((state) => state.end);

  useLayoutEffect(() => {
    const currentTime = activeData?.currentTime;
    if (!currentTime) {
      return;
    }

    if (cutStart != undefined && cutEnd != undefined) {
      const current = toNanoSec(currentTime);
      if (repeatEnabled && current >= cutEnd) {
        seek(fromNanoSec(cutStart));
        play();
      } else if (current > cutEnd) {
        pause();
        seek(fromNanoSec(cutEnd));
      } else if (current < cutStart) {
        seek(fromNanoSec(cutStart));
      }
      return;
    }

    const { startTime, endTime } = activeData;

    // repeat logic could also live in messagePipeline but since it is only triggered
    // from playback controls we've implemented it here for now - if there is demand
    // to toggle repeat from elsewhere this logic can move
    if (repeatEnabled && compare(currentTime, endTime) >= 0) {
      seek(startTime);
      // if the user turns on repeat and we are at the end, we assume they want to play from start
      // even if paused
      play();
    }
  }, [activeData, cutEnd, cutStart, pause, play, repeatEnabled, seek]);

  return <></>;
}
