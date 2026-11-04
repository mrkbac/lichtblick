// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Log as FoxgloveLog } from "@foxglove/schemas";

import { Time, MessageEvent } from "@lichtblick/suite";
import { Header } from "@lichtblick/suite-base/types/Messages";

export type VisibilityFilter = Record<string, { visible?: boolean }>;

export type Config = {
  searchTerms: string[];
  minLogLevel: number;
  /** Legacy single-topic selection; replaced by `topics` once the user toggles a topic */
  topicToRender?: string;
  /** Per-topic visibility. Topics not listed are shown. */
  topics?: VisibilityFilter;
  nameFilter?: VisibilityFilter;
  /** Treat search terms as regular expressions */
  regex?: boolean;
  caseSensitive?: boolean;
};

export enum LogLevel {
  UNKNOWN = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  FATAL = 5,
}

export type Ros1RosgraphMsgs$Log = Readonly<{
  header: Header;
  level: number;
  name: string;
  msg: string;
  file: string;
  function: string;
  line: number;
  topics: readonly string[];
}>;

export type Ros2RosgraphMsgs$Log = Readonly<{
  stamp: Time;
  level: number;
  name: string;
  msg: string;
  file: string;
  function: string;
  line: number;
}>;

export type NormalizedLogMessage = {
  topic: string;
  /** Time the message was received/recorded; used for seeking and ordering */
  receiveTime: Time;
  /** Time from the log message itself */
  stamp: Time;
  level: LogLevel;
  message: string;
  name?: string;
  file?: string;
  line?: number;
};

export type LogMessageEvent =
  | MessageEvent<FoxgloveLog>
  | MessageEvent<Ros1RosgraphMsgs$Log>
  | MessageEvent<Ros2RosgraphMsgs$Log>;
