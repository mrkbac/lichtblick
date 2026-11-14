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

import { useCallback } from "react";

import { ReadonlyRingBuffer, RingBuffer } from "@lichtblick/den/collection";
import { useDeepMemo } from "@lichtblick/hooks";
import { MessageEvent, SubscribePayload } from "@lichtblick/suite-base/players/types";

import { useMessageReducer } from "./useMessageReducer";

export type MessageHistoryByTopic = Readonly<Record<string, ReadonlyRingBuffer<MessageEvent>>>;

/**
 * useMessagesByTopic makes it easy to request some messages on some topics.
 *
 * Returns the newest `historySize` messages per topic. Each topic's buffer is appended in place
 * (no per-frame copy of the history); the returned record is a new object whenever any topic
 * received messages, so memoize on the record, or use `pushed()` to process only new messages.
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
  const { historySize, topics } = params;
  const requestedTopics = useDeepMemo(topics);

  const addMessages = useCallback(
    (prev: Record<string, RingBuffer<MessageEvent>>, messages: readonly MessageEvent[]) => {
      let changed = false;
      for (const message of messages) {
        const buffer = prev[message.topic];
        if (buffer) {
          buffer.push(message);
          changed = true;
        }
      }
      return changed ? { ...prev } : prev;
    },
    [],
  );

  const restore = useCallback(
    (prev?: Record<string, RingBuffer<MessageEvent>>) => {
      const next: Record<string, RingBuffer<MessageEvent>> = {};
      // When changing topics, keep the history of topics that are still requested.
      for (const topic of requestedTopics) {
        const topicName = typeof topic === "string" ? topic : topic.topic;
        const prevBuffer = prev?.[topicName];
        next[topicName] =
          prevBuffer?.capacity === historySize
            ? prevBuffer
            : RingBuffer.from(historySize, prevBuffer ?? []);
      }
      return next;
    },
    [requestedTopics, historySize],
  );

  return useMessageReducer({
    topics: requestedTopics,
    restore,
    addMessages,
  });
}
