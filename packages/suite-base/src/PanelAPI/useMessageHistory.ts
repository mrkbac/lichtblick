// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback } from "react";

import { ReadonlyRingBuffer, RingBuffer } from "@lichtblick/den/collection";
import { useDeepMemo } from "@lichtblick/hooks";
import { MessageEvent, SubscribePayload } from "@lichtblick/suite-base/players/types";

import { useMessageReducer } from "./useMessageReducer";

export type HistoryByTopic<T> = Readonly<Record<string, ReadonlyRingBuffer<T>>>;

/**
 * The newest `historySize` items per topic, where each message is turned into an item by `map`
 * once, when it arrives. Keep only what the panel draws (a value, a normalized row) instead of
 * whole messages, so a long history doesn't hold every decoded message.
 *
 * Each topic's buffer is appended in place (no per-frame copy); the returned record is a new
 * object whenever any topic received items, so memoize on the record, or use `pushed()` to
 * process only what is new. After a seek the history starts over.
 */
export function useMessageHistory<T>(params: {
  topics: readonly string[] | SubscribePayload[];
  /** Required and finite: items kept per topic. */
  historySize: number;
  /** Must be stable (e.g. module-level or useCallback). Return undefined to skip a message. */
  map: (message: MessageEvent) => T | undefined;
}): HistoryByTopic<T> {
  const { historySize, topics, map } = params;
  const requestedTopics = useDeepMemo(topics);

  const addMessages = useCallback(
    (prev: Record<string, RingBuffer<T>>, messages: readonly MessageEvent[]) => {
      let changed = false;
      for (const message of messages) {
        const buffer = prev[message.topic];
        const item = buffer ? map(message) : undefined;
        if (item != undefined) {
          buffer!.push(item);
          changed = true;
        }
      }
      return changed ? { ...prev } : prev;
    },
    [map],
  );

  const restore = useCallback(
    (prev?: Record<string, RingBuffer<T>>) => {
      const next: Record<string, RingBuffer<T>> = {};
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

  return useMessageReducer({ topics: requestedTopics, restore, addMessages });
}
