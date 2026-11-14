// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useMemo, useRef, useState } from "react";
import { useLatest } from "react-use";

import { parseMessagePath } from "@lichtblick/message-path";
import { useCachedGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import {
  PathSample,
  toPathSample,
} from "@lichtblick/suite-base/components/MessagePathSyntax/usePathSampleHistory";
import { useSubscribeMessageRange } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import useGlobalVariables from "@lichtblick/suite-base/hooks/useGlobalVariables";

/** Decoded samples of each path over the whole recording, oldest first. */
export type PathSamplesByPath = Readonly<Record<string, readonly PathSample[]>>;

const FLUSH_INTERVAL_MS = 250;

type TopicRequest = { paths: string[]; key: string };

/**
 * Loads `pathStrings` over the whole recording. Each batch is decoded as it arrives and only the
 * decoded samples are kept, so memory doesn't depend on message size and a flush never re-reads
 * earlier batches.
 *
 * A topic is reloaded when the paths reading it change (or, for paths using `$variables`, when
 * global variables change), since the messages themselves are not kept.
 */
export function useDecodedMessageRange(
  topics: readonly string[],
  pathStrings: readonly string[],
): PathSamplesByPath[] {
  const subscribeMessageRange = useSubscribeMessageRange();
  const decodeRef = useLatest(useCachedGetMessagePathDataItems(pathStrings));
  const pathsRef = useLatest(pathStrings);
  const { globalVariables } = useGlobalVariables();

  const requestByTopic = useMemo(() => {
    const pathsByTopic = new Map<string, Set<string>>();
    for (const path of pathStrings) {
      const topic = parseMessagePath(path)?.topicName;
      if (topic != undefined && topics.includes(topic)) {
        pathsByTopic.set(topic, (pathsByTopic.get(topic) ?? new Set()).add(path));
      }
    }
    const result = new Map<string, TopicRequest>();
    for (const [topic, pathSet] of pathsByTopic) {
      const paths = [...pathSet].sort();
      const variables = paths.some((path) => path.includes("$"))
        ? JSON.stringify(globalVariables)
        : "";
      result.set(topic, { paths, key: JSON.stringify([paths, variables]) ?? "" });
    }
    return result;
  }, [globalVariables, pathStrings, topics]);

  const [samplesByPath, setSamplesByPath] = useState<PathSamplesByPath>({});
  // Mutated in place while loading; published as a new outer object on each flush.
  const accRef = useRef<Record<string, PathSample[]>>({});
  const flushRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Never replace .current, only mutate: the unmount cleanup captures it at mount.
  const subsRef = useRef(new Map<string, TopicRequest & { cancel: () => void }>());

  useEffect(() => {
    const subs = subsRef.current;
    const acc = accRef.current;
    const publish = () => {
      setSamplesByPath({ ...acc });
    };

    let removed = false;
    for (const [topic, sub] of subs) {
      if (requestByTopic.get(topic)?.key !== sub.key) {
        sub.cancel();
        subs.delete(topic);
        for (const path of sub.paths) {
          delete acc[path];
        }
        removed = true;
      }
    }

    for (const [topic, request] of requestByTopic) {
      if (subs.has(topic)) {
        continue;
      }
      let cancelled = false;
      const cancel = subscribeMessageRange({
        topic,
        onNewRangeIterator: async (batchIterator) => {
          // A new iterator replaces the topic's data (e.g. an edited user script).
          for (const path of request.paths) {
            acc[path] = [];
          }
          publish();
          for await (const batch of batchIterator) {
            // The resolver can already be the next render's, before this effect cancels us.
            if (cancelled || request.paths.some((path) => !pathsRef.current.includes(path))) {
              return;
            }
            for (const path of request.paths) {
              const out = (acc[path] ??= []);
              for (const message of batch) {
                const queriedData = decodeRef.current(path, message);
                if (queriedData) {
                  out.push(toPathSample(message, queriedData));
                }
              }
            }
            // Group batches arriving in quick succession into one update.
            flushRef.current ??= setTimeout(() => {
              flushRef.current = undefined;
              publish();
            }, FLUSH_INTERVAL_MS);
          }
          if (!cancelled) {
            publish();
          }
        },
      });
      subs.set(topic, {
        ...request,
        cancel: () => {
          cancelled = true;
          cancel();
        },
      });
    }

    if (removed) {
      publish();
    }
  }, [decodeRef, pathsRef, requestByTopic, subscribeMessageRange]);

  // Clean up all subscriptions on unmount.
  useEffect(() => {
    const subs = subsRef.current;
    const flush = flushRef;
    return () => {
      clearTimeout(flush.current);
      flush.current = undefined;
      for (const { cancel } of subs.values()) {
        cancel();
      }
      subs.clear();
    };
  }, []);

  return useMemo(() => [samplesByPath], [samplesByPath]);
}
