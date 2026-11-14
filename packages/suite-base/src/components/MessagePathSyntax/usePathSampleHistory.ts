// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";
import { useCallback, useMemo } from "react";
import { useLatest } from "react-use";

import { filterMap, ReadonlyRingBuffer, RingBuffer } from "@lichtblick/den/collection";
import { useShallowMemo } from "@lichtblick/hooks";
import { parseMessagePath } from "@lichtblick/message-path";
import { useMessageReducer } from "@lichtblick/suite-base/PanelAPI/useMessageReducer";
import {
  MessagePathDataItem,
  useCachedGetMessagePathDataItems,
} from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { subscribePayloadFromMessagePath } from "@lichtblick/suite-base/players/subscribePayloadFromMessagePath";
import { MessageEvent } from "@lichtblick/suite-base/players/types";
import { getTimestampForMessage } from "@lichtblick/suite-base/util/time";

/**
 * A message path's value in one message, without the message: keeping samples instead of
 * MessageEvents lets a long history hold just the values a panel draws.
 */
export type PathSample = {
  receiveTime: Time;
  /** The message's header stamp, if it has one. */
  headerStamp: Time | undefined;
  queriedData: MessagePathDataItem[];
};

export type PathSampleHistoryByPath = Readonly<Record<string, ReadonlyRingBuffer<PathSample>>>;

export function toPathSample(
  message: MessageEvent,
  queriedData: MessagePathDataItem[],
): PathSample {
  const stamp = getTimestampForMessage(message.message);
  return {
    receiveTime: message.receiveTime,
    // Copy, so the sample never keeps the message alive through a lazily decoded stamp
    headerStamp: stamp ? { sec: stamp.sec, nsec: stamp.nsec } : undefined,
    queriedData,
  };
}

/**
 * Decoded values of `paths` for the newest `historySize` messages of each path. Each message is
 * decoded once when it arrives and then dropped.
 *
 * The buffers are appended in place; the returned record is a new object whenever any path got a
 * sample. After a seek the history starts over.
 */
export function usePathSampleHistory(
  paths: readonly string[],
  /** Required and finite: samples kept per path. */
  historySize: number,
): PathSampleHistoryByPath {
  const memoizedPaths = useShallowMemo(paths);
  const subscribeTopics = useMemo(
    () => filterMap(memoizedPaths, (path) => subscribePayloadFromMessagePath(path)),
    [memoizedPaths],
  );
  const topicByPath = useMemo(
    () =>
      new Map(
        filterMap(memoizedPaths, (path) => {
          const topic = parseMessagePath(path)?.topicName;
          return topic != undefined ? ([path, topic] as const) : undefined;
        }),
      ),
    [memoizedPaths],
  );

  // The resolver changes identity whenever topics or datatypes do, which on live sources happens
  // when any topic appears. New messages use the latest one; the history is kept.
  const decodeRef = useLatest(useCachedGetMessagePathDataItems(memoizedPaths));

  const restore = useCallback(
    (prev?: Record<string, RingBuffer<PathSample>>) => {
      const next: Record<string, RingBuffer<PathSample>> = {};
      for (const path of topicByPath.keys()) {
        const prevBuffer = prev?.[path];
        next[path] =
          prevBuffer?.capacity === historySize
            ? prevBuffer
            : RingBuffer.from(historySize, prevBuffer ?? []);
      }
      return next;
    },
    [topicByPath, historySize],
  );

  const addMessages = useCallback(
    (prev: Record<string, RingBuffer<PathSample>>, messages: readonly MessageEvent[]) => {
      let changed = false;
      for (const [path, topic] of topicByPath) {
        const buffer = prev[path];
        if (!buffer) {
          continue;
        }
        for (const message of messages) {
          if (message.topic !== topic) {
            continue;
          }
          const queriedData = decodeRef.current(path, message);
          if (queriedData) {
            buffer.push(toPathSample(message, queriedData));
            changed = true;
          }
        }
      }
      return changed ? { ...prev } : prev;
    },
    [decodeRef, topicByPath],
  );

  return useMessageReducer({ topics: subscribeTopics, restore, addMessages });
}
