// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { MessageEvent, SubscribePayload } from "@lichtblick/suite-base/players/types";

import { HistoryByTopic, useMessageHistory } from "./useMessageHistory";

export type MessageHistoryByTopic = HistoryByTopic<MessageEvent>;

const identity = (message: MessageEvent) => message;

/**
 * useMessagesByTopic makes it easy to request some messages on some topics: the newest
 * `historySize` whole messages per topic. To keep a long history, keep less per message with
 * `useMessageHistory` (or `usePathSampleHistory` for message path values).
 *
 * Using this hook will cause the panel to re-render when new messages arrive on the requested topics.
 * - During file playback the panel will re-render when the file is playing or when the user is scrubbing.
 * - During live playback the panel will re-render when new messages arrive.
 */
export function useMessagesByTopic(params: {
  topics: readonly string[] | SubscribePayload[];
  /** Required and finite: the number of messages kept per topic. */
  historySize: number;
}): MessageHistoryByTopic {
  return useMessageHistory({ ...params, map: identity });
}
