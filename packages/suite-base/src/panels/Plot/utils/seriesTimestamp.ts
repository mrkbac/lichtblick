// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromNanoSec, fromSec, isTime } from "@foxglove/rostime";

import { MessagePath } from "@lichtblick/message-path";
import { Immutable, MessageEvent, Time } from "@lichtblick/suite";
import { simpleGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { getTimestampForMessage } from "@lichtblick/suite-base/util/time";

import { PlotTimestampMethod } from "./config";

/**
 * A time read from a message field: a time/duration, integer nanoseconds (int64/uint64 fields) or
 * seconds (other numbers).
 */
export function timeFromFieldValue(value: unknown): Time | undefined {
  if (isTime(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return fromNanoSec(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return fromSec(value);
  }
  return undefined;
}

/** The time a series places a message at, or undefined when the message has none. */
export function getSeriesTimestamp(
  event: Immutable<MessageEvent>,
  method: PlotTimestampMethod,
  timestampPath: Immutable<MessagePath> | undefined,
): Time | undefined {
  switch (method) {
    case "receiveTime":
      return event.receiveTime;
    case "customField":
      return timestampPath
        ? timeFromFieldValue(simpleGetMessagePathDataItems(event, timestampPath)[0])
        : undefined;
    case "headerStamp":
    default:
      // Layouts without a method have always used the header stamp here
      return getTimestampForMessage(event.message);
  }
}
