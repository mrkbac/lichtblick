// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { subtract, toSec } from "@foxglove/rostime";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";

import { sideSharedEnd, useCompare } from "./CompareContext";

const selectStart = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEnd = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;

/** Where each compared recording lies on the playback bar, as a thin bar in its color */
export function CompareTimelineOverlay(): React.JSX.Element | undefined {
  const compare = useCompare();
  const startTime = useMessagePipeline(selectStart);
  const endTime = useMessagePipeline(selectEnd);
  if (!compare || !startTime || !endTime) {
    return undefined;
  }
  const total = toSec(subtract(endTime, startTime));
  if (total <= 0) {
    return undefined;
  }
  const fraction = (time: Parameters<typeof toSec>[0]) =>
    Math.min(1, Math.max(0, toSec(subtract(time, startTime)) / total));
  return (
    <>
      {compare.sides.map((side, index) => {
        const left = fraction(side.sharedStart);
        const right = fraction(sideSharedEnd(side));
        return (
          <div
            key={side.prefix}
            title={`${side.label} · ${side.name}`}
            style={{
              position: "absolute",
              left: `${left * 100}%`,
              width: `${Math.max(0, right - left) * 100}%`,
              bottom: 2 + index * 3,
              height: 2,
              borderRadius: 1,
              backgroundColor: side.color,
              pointerEvents: "none",
            }}
          />
        );
      })}
    </>
  );
}
