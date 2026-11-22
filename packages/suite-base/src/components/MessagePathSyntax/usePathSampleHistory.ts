// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useMemo, useRef } from "react";

import { filterMap } from "@lichtblick/den/collection";
import { useLatest, useShallowMemo } from "@lichtblick/hooks";
import { parseMessagePath } from "@lichtblick/message-path";
import { useMessageReducer } from "@lichtblick/suite-base/PanelAPI/useMessageReducer";
import { useCachedGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import useGlobalVariables from "@lichtblick/suite-base/hooks/useGlobalVariables";
import { subscribePayloadFromMessagePath } from "@lichtblick/suite-base/players/subscribePayloadFromMessagePath";
import { MessageEvent } from "@lichtblick/suite-base/players/types";

import { PathSampleColumns } from "./PathSampleColumns";

export type PathSampleHistoryByPath = Readonly<Record<string, PathSampleColumns>>;

/**
 * Decoded values of `paths`, at most `maxSamples` per path (thinned evenly beyond that, see
 * PathSampleColumns). Each message is decoded once when it arrives and then dropped.
 *
 * The columns are appended in place; the returned record is a new object whenever any path got a
 * sample. After a seek the history starts over.
 */
export function usePathSampleHistory(
  paths: readonly string[],
  /** Required and finite: samples kept per path. */
  maxSamples: number,
): PathSampleHistoryByPath {
  const memoizedPaths = useShallowMemo(paths);
  const subscribeTopics = useMemo(
    () =>
      filterMap(memoizedPaths, (path) => {
        const payload = subscribePayloadFromMessagePath(path);
        // A field-projected message must keep its header for `headerStamp`.
        return payload?.fields ? { ...payload, fields: [...payload.fields, "header"] } : payload;
      }),
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

  // Paths using `$variables` resolve differently once variables change; their old samples would
  // mix two filters, so they start over. Other paths keep their history.
  const { globalVariables } = useGlobalVariables();
  const variablesKey = memoizedPaths.some((path) => path.includes("$"))
    ? (JSON.stringify(globalVariables) ?? "")
    : "";
  const bufferKeysRef = useRef(new Map<string, string>());

  const restore = useCallback(
    (prev?: Record<string, PathSampleColumns>) => {
      const next: Record<string, PathSampleColumns> = {};
      const keys = bufferKeysRef.current;
      for (const path of topicByPath.keys()) {
        const key = path.includes("$") ? variablesKey : "";
        const prevBuffer = keys.get(path) === key ? prev?.[path] : undefined;
        keys.set(path, key);
        next[path] =
          prevBuffer?.maxSamples === maxSamples
            ? prevBuffer
            : PathSampleColumns.from(prevBuffer?.toArray() ?? [], maxSamples);
      }
      return next;
    },
    [topicByPath, maxSamples, variablesKey],
  );

  const addMessages = useCallback(
    (prev: Record<string, PathSampleColumns>, messages: readonly MessageEvent[]) => {
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
            buffer.pushMessage(message, queriedData);
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
