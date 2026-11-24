// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time, toSec } from "@foxglove/rostime";
import { useMemo } from "react";

import {
  useMessagePipeline,
  useMessagePipelineBatchedWhenHidden,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  selectCurrentTime,
  selectEndTime,
  selectLastSeekTime,
  selectStartTime,
} from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { subtractTimes } from "@lichtblick/suite-base/players/UserScriptPlayer/transformerWorker/typescript/userUtils/time";

type UseStateTransitionsTime = {
  startTime: Readonly<Time> | undefined;
  currentTimeSinceStart: number | undefined;
  endTimeSinceStart: number | undefined;
};

const useStateTransitionsTime = (): UseStateTransitionsTime => {
  const startTime = useMessagePipeline(selectStartTime);
  // The whole panel re-renders with the playhead; a hidden one catches up once per interval
  const currentTime = useMessagePipelineBatchedWhenHidden(selectCurrentTime, {
    flushKey: selectLastSeekTime,
  });
  const endTime = useMessagePipeline(selectEndTime);

  const currentTimeSinceStart = useMemo(
    () => (currentTime && startTime ? toSec(subtractTimes(currentTime, startTime)) : undefined),
    [currentTime, startTime],
  );

  const endTimeSinceStart = useMemo(
    () => (endTime && startTime ? toSec(subtractTimes(endTime, startTime)) : undefined),
    [endTime, startTime],
  );

  return { startTime, currentTimeSinceStart, endTimeSinceStart };
};

export default useStateTransitionsTime;
