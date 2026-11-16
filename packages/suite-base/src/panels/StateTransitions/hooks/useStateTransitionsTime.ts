// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time, toSec } from "@foxglove/rostime";
import { useMemo } from "react";

import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import {
  selectCurrentTime,
  selectEndTime,
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
  const currentTime = useMessagePipeline(selectCurrentTime);
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
