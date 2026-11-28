// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useMemo, useRef } from "react";

import { filterMap } from "@lichtblick/den/collection";
import { useLatest, useShallowMemo } from "@lichtblick/hooks";
import { parseMessagePath } from "@lichtblick/message-path";
import { useMessageReducer } from "@lichtblick/suite-base/PanelAPI/useMessageReducer";
import {
  fillInGlobalVariablesInPath,
  useCachedGetMessagePathDataItems,
} from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import useGlobalVariables, {
  GlobalVariables,
} from "@lichtblick/suite-base/hooks/useGlobalVariables";
import { subscribePayloadFromMessagePath } from "@lichtblick/suite-base/players/subscribePayloadFromMessagePath";
import { MessageEvent } from "@lichtblick/suite-base/players/types";

import { PathSampleColumns } from "./PathSampleColumns";

/** The path with its `$variables` filled in: changes only when a variable the path uses does */
function variablesKeyOf(path: string, variables: GlobalVariables): string {
  const parsed = path.includes("$") ? parseMessagePath(path) : undefined;
  return parsed
    ? (JSON.stringify(fillInGlobalVariablesInPath(parsed, variables), (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ) ?? "")
    : "";
}

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
  /** Paths whose exact value changes are kept apart once thinned (see trackChanges). */
  changesPaths: readonly string[] = [],
): PathSampleHistoryByPath {
  const changesPathsRef = useLatest(changesPaths);
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

  // A path using `$variables` resolves differently once one of its variables changes; its old
  // samples would mix two filters, so it starts over. Other paths keep their history.
  const { globalVariables } = useGlobalVariables();
  const bufferKeysRef = useRef(new Map<string, string>());

  const restore = useCallback(
    (prev?: Record<string, PathSampleColumns>) => {
      const next: Record<string, PathSampleColumns> = {};
      const keys = bufferKeysRef.current;
      for (const path of topicByPath.keys()) {
        const key = variablesKeyOf(path, globalVariables);
        const prevBuffer = keys.get(path) === key ? prev?.[path] : undefined;
        keys.set(path, key);
        next[path] = prevBuffer ?? new PathSampleColumns(maxSamples);
      }
      return next;
    },
    [topicByPath, maxSamples, globalVariables],
  );

  const addMessages = useCallback(
    (prev: Record<string, PathSampleColumns>, messages: readonly MessageEvent[]) => {
      let changed = false;
      for (const [path, topic] of topicByPath) {
        const buffer = prev[path];
        if (!buffer) {
          continue;
        }
        if (changesPathsRef.current.includes(path)) {
          buffer.trackChanges();
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
    [changesPathsRef, decodeRef, topicByPath],
  );

  return useMessageReducer({ topics: subscribeTopics, restore, addMessages });
}
