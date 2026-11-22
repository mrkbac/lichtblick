// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fromNanoSec } from "@foxglove/rostime";

import { MessageEvent, Time } from "@lichtblick/suite";
import { stampToTime } from "@lichtblick/suite-base/util/time";

import { LogLevel, NormalizedLogMessage } from "./types";

const FOXGLOVE_DATATYPES = new Set([
  "foxglove_msgs/Log",
  "foxglove_msgs/msg/Log",
  "foxglove.Log",
  "foxglove::Log",
]);

export const SUPPORTED_DATATYPES = new Set([
  ...FOXGLOVE_DATATYPES,
  "rcl_interfaces/msg/Log",
  "ros.rcl_interfaces.Log",
  "ros.rosgraph_msgs.Log",
  "rosgraph_msgs/Log",
]);

type RawLog = {
  level?: number;
  msg?: string;
  message?: string;
  name?: string;
  file?: string;
  line?: number;
  timestamp?: unknown;
  stamp?: unknown;
  header?: { stamp?: unknown };
};

const ZERO: Time = { sec: 0, nsec: 0 };

/** Accepts {sec,nsec}, ROS 2 {sec,nanosec}, protobuf {seconds,nanos} and bigint nanoseconds. */
function toTime(value: unknown): Time | undefined {
  if (typeof value === "bigint") {
    return fromNanoSec(value);
  }
  if (value == undefined || typeof value !== "object") {
    return undefined;
  }
  const t = value as {
    sec?: number | bigint;
    nsec?: number;
    nanosec?: number;
    seconds?: number | bigint;
    nanos?: number;
  };
  if (t.sec != undefined) {
    return stampToTime(t) ?? { sec: Number(t.sec), nsec: t.nsec ?? t.nanosec ?? 0 };
  }
  if (t.seconds != undefined) {
    return { sec: Number(t.seconds), nsec: t.nanos ?? 0 };
  }
  return undefined;
}

// Get the log message string from the log message
export function getNormalizedMessage(logMessage: Partial<RawLog>): string {
  if ("msg" in logMessage) {
    return logMessage.msg ?? "";
  } else if ("message" in logMessage) {
    return logMessage.message ?? "";
  }

  return "";
}

export function getNormalizedLevel(datatype: string, raw: Partial<RawLog>): LogLevel {
  if (FOXGLOVE_DATATYPES.has(datatype)) {
    return raw.level ?? LogLevel.UNKNOWN;
  }
  if (SUPPORTED_DATATYPES.has(datatype)) {
    return rosLevelToLogLevel(raw.level ?? 0);
  }
  return LogLevel.UNKNOWN;
}

export function getNormalizedStamp(raw: Partial<RawLog>): Time {
  return toTime(raw.timestamp) ?? toTime(raw.stamp) ?? toTime(raw.header?.stamp) ?? ZERO;
}

const cache = new WeakMap<MessageEvent, NormalizedLogMessage>();

// Decoders return a new string per message, so a node name or file repeated in millions of log
// lines would be stored millions of times.
// ponytail: grows with the number of distinct names/files (a few hundred in practice); stops
// adding past MAX_INTERNED so a source with unique names can't grow it without bound.
const MAX_INTERNED = 10_000;
const interned = new Map<string, string>();

/** One shared copy of `value` for all messages that repeat it. */
function intern(value: string | undefined): string | undefined {
  if (value == undefined) {
    return value;
  }
  const shared = interned.get(value);
  if (shared != undefined) {
    return shared;
  }
  if (interned.size < MAX_INTERNED) {
    interned.set(value, value);
  }
  return value;
}

/** Normalize a log message event. Results are cached per event object. */
export function normalizeLogEvent(event: MessageEvent): NormalizedLogMessage {
  let normalized = cache.get(event);
  if (normalized == undefined) {
    const raw = (event.message ?? {}) as Partial<RawLog>;
    normalized = {
      topic: event.topic,
      receiveTime: event.receiveTime,
      message: getNormalizedMessage(raw),
      stamp: getNormalizedStamp(raw),
      level: getNormalizedLevel(event.schemaName, raw),
      name: intern(raw.name),
      file: intern(raw.file),
      line: raw.line,
    };
    cache.set(event, normalized);
  }
  return normalized;
}

function rosLevelToLogLevel(rosLevel: number): LogLevel {
  switch (rosLevel) {
    case 1:
    case 10:
      return LogLevel.DEBUG;
    case 2:
    case 20:
      return LogLevel.INFO;
    case 4:
    case 30:
      return LogLevel.WARN;
    case 8:
    case 40:
      return LogLevel.ERROR;
    case 16:
    case 50:
      return LogLevel.FATAL;
    default:
      return LogLevel.UNKNOWN;
  }
}
