// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Time } from "@foxglove/rostime";
import { add as addTime, compare, subtract as subtractTime } from "@foxglove/rostime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Logger from "@lichtblick/log";
import { parseMessagePath, MessagePath, MessagePathStructureItem } from "@lichtblick/message-path";
import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";
import {
  messagePathStructures,
  traverseStructure,
} from "@lichtblick/suite-base/components/MessagePathSyntax/messagePathsForDatatype";
import {
  MessageAndData,
  useCachedGetMessagePathDataItems,
} from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { useMessageDataItem } from "@lichtblick/suite-base/components/MessagePathSyntax/useMessageDataItem";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import { Topic } from "@lichtblick/suite-base/players/types";

import { PREV_MSG_METHOD } from "./constants";
import { NodeState } from "./types";
import type {
  UseSharedRawMessagesLogicProps,
  SharedConfig,
  UseSharedRawMessagesLogicResult,
} from "./types";
import {
  dataWithoutWrappingArray,
  generateDeepKeyPaths,
  isNodeExpanded,
  toggleNodeExpansion,
} from "./utils";

const log = Logger.getLogger(__filename);

const ONE_NANOSECOND = Object.freeze({ sec: 0, nsec: 1 });

const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectTopicStats = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.topicStats;
const selectSeekPlayback = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectPausePlayback = (ctx: MessagePipelineContext) => ctx.pausePlayback;
const selectGetBatchIterator = (ctx: MessagePipelineContext) => ctx.getBatchIterator;
const selectGetMessageAtTime = (ctx: MessagePipelineContext) => ctx.getMessageAtTime;

const LATEST_PER_RENDER_TICK_SAMPLING = Object.freeze({
  mode: "latest-per-render-tick" as const,
});

/**
 * Shared hook that contains all the common logic for both RawMessages and RawMessagesVirtual panels.
 * This includes state management, message subscriptions, expansion logic, and common callbacks.
 */
export function useSharedRawMessagesLogic<T extends SharedConfig>({
  config,
  saveConfig,
}: UseSharedRawMessagesLogicProps<T>): UseSharedRawMessagesLogicResult {
  const { topicPath, diffMethod, diffTopicPath, diffEnabled } = config;
  const { topics, datatypes } = useDataSourceInfo();
  const { setMessagePathDropConfig } = usePanelContext();

  useEffect(() => {
    setMessagePathDropConfig({
      getDropStatus(paths) {
        if (paths.length !== 1) {
          return { canDrop: false };
        }
        return { canDrop: true, effect: "replace" };
      },
      handleDrop(paths) {
        const path = paths[0];
        if (path) {
          saveConfig({ topicPath: path.path } as Partial<T>);
          setExpansion("none");
        }
      },
    });
  }, [setMessagePathDropConfig, saveConfig]);

  const topicRosPath: MessagePath | undefined = useMemo(
    () => parseMessagePath(topicPath),
    [topicPath],
  );

  const topic: Topic | undefined = useMemo(
    () => topicRosPath && topics.find(({ name }) => name === topicRosPath.topicName),
    [topicRosPath, topics],
  );

  const structures = useMemo(() => messagePathStructures(datatypes), [datatypes]);

  const rootStructureItem: MessagePathStructureItem | undefined = useMemo(() => {
    if (!topic || !topicRosPath || topic.schemaName == undefined) {
      return;
    }
    return traverseStructure(structures[topic.schemaName], topicRosPath.messagePath).structureItem;
  }, [structures, topic, topicRosPath]);

  const [expansion, setExpansion] = useState(config.expansion);

  const samplingRequest = LATEST_PER_RENDER_TICK_SAMPLING;
  const matchedMessages = useMessageDataItem(topic ? topicPath : "", {
    historySize: 2,
    samplingRequest,
  });
  const diffMessages = useMessageDataItem(diffEnabled ? diffTopicPath : "", { samplingRequest });

  const diffTopicObj = diffMessages[0];
  const currTickObj = matchedMessages[matchedMessages.length - 1];
  const prevTickObj = matchedMessages[matchedMessages.length - 2];

  const inTimetickDiffMode = diffEnabled && diffMethod === PREV_MSG_METHOD;

  const currentTime = useMessagePipeline(selectCurrentTime);
  const topicStats = useMessagePipeline(selectTopicStats);
  const seekPlayback = useMessagePipeline(selectSeekPlayback);
  const pausePlayback = useMessagePipeline(selectPausePlayback);
  const getBatchIterator = useMessagePipeline(selectGetBatchIterator);
  const getMessageAtTime = useMessagePipeline(selectGetMessageAtTime);
  const cachedGetMessagePathDataItems = useCachedGetMessagePathDataItems([topicPath]);

  // A seek resets the message history, so after stepping (or scrubbing) there is no previous
  // tick to diff against. Read the message before the current one directly from the source.
  // Until it arrives, keep showing the last pair so the panel doesn't flash "Waiting…" (which
  // would also unmount the focused step button).
  const [fetchedPair, setFetchedPair] = useState<{ base?: MessageAndData; diff: MessageAndData }>();
  const currMessageEvent = currTickObj?.messageEvent;
  const needsFetchedPrev = inTimetickDiffMode && prevTickObj == undefined;
  useEffect(() => {
    setFetchedPair(undefined);
  }, [topicPath]);
  useEffect(() => {
    if (!needsFetchedPrev || !currTickObj) {
      return;
    }
    let cancelled = false;
    const { messageEvent: curr } = currTickObj;
    getMessageAtTime(curr.topic, subtractTime(curr.receiveTime, ONE_NANOSECOND))
      .then((messageEvent) => {
        const queriedData = messageEvent && cachedGetMessagePathDataItems(topicPath, messageEvent);
        if (!cancelled) {
          setFetchedPair({
            base:
              messageEvent && queriedData && queriedData.length > 0
                ? { messageEvent, queriedData }
                : undefined,
            diff: currTickObj,
          });
        }
      })
      .catch((error: unknown) => {
        log.warn("Failed to read previous message for diff", error);
      });
    return () => {
      cancelled = true;
    };
  }, [needsFetchedPrev, currTickObj, getMessageAtTime, cachedGetMessagePathDataItems, topicPath]);

  const baseItem = inTimetickDiffMode ? (prevTickObj ?? fetchedPair?.base) : currTickObj;
  const diffItem = inTimetickDiffMode
    ? prevTickObj
      ? currTickObj
      : fetchedPair?.diff
    : diffTopicObj;

  const nodes = useMemo(() => {
    if (baseItem) {
      const data = dataWithoutWrappingArray(baseItem.queriedData.map(({ value }) => value));
      return generateDeepKeyPaths(data);
    } else {
      return new Set<string>();
    }
  }, [baseItem]);

  const canExpandAll = useMemo(() => {
    if (expansion === "none") {
      return true;
    }
    if (expansion === "all") {
      return false;
    }
    return typeof expansion === "object" && Object.values(expansion).includes(NodeState.Collapsed);
  }, [expansion]);

  const onTopicPathChange = useCallback(
    (newTopicPath: string) => {
      setExpansion("none");
      saveConfig({ topicPath: newTopicPath } as Partial<T>);
    },
    [saveConfig],
  );

  const onDiffTopicPathChange = useCallback(
    (newDiffTopicPath: string) => {
      saveConfig({ diffTopicPath: newDiffTopicPath } as Partial<T>);
    },
    [saveConfig],
  );

  const onToggleDiff = useCallback(() => {
    saveConfig({ diffEnabled: !diffEnabled } as Partial<T>);
  }, [diffEnabled, saveConfig]);

  const onToggleExpandAll = useCallback(() => {
    setExpansion(canExpandAll ? "all" : "none");
  }, [canExpandAll]);

  const isExpanded = useCallback(
    (key: string, value: unknown) => isNodeExpanded(expansion, key, value),
    [expansion],
  );

  const onToggleExpand = useCallback(
    (key: string, value: unknown) => {
      setExpansion((old) => toggleNodeExpansion(old, nodes, key, value));
    },
    [nodes],
  );

  useEffect(() => {
    saveConfig({ expansion } as Partial<T>);
  }, [expansion, saveConfig]);

  // Message stepping: seek to the previous/next message on the topic. Only for sources that can
  // seek; live sources have nothing to step through.
  // A ref, not state: disabling the focused button mid-step would drop focus and the shortcuts.
  const isSteppingRef = useRef(false);
  const canStep = seekPlayback != undefined && topic != undefined;
  const stats = topic ? topicStats?.get(topic.name) : undefined;
  // Step back from the displayed message rather than the playhead, so the first click always
  // changes what is shown even when the playhead sits between two messages.
  const prevAnchorTime = currMessageEvent?.receiveTime ?? currentTime;
  const canStepPrevious =
    canStep &&
    prevAnchorTime != undefined &&
    (stats?.firstMessageTime == undefined || compare(prevAnchorTime, stats.firstMessageTime) > 0);
  const canStepNext =
    canStep &&
    currentTime != undefined &&
    (stats?.lastMessageTime == undefined || compare(currentTime, stats.lastMessageTime) < 0);

  const seekTo = useCallback(
    async (findTime: () => Promise<Time | undefined>) => {
      if (isSteppingRef.current) {
        return;
      }
      isSteppingRef.current = true;
      try {
        const time = await findTime();
        if (time) {
          pausePlayback?.();
          seekPlayback?.(time);
        }
      } catch (error) {
        log.warn("Failed to step to message", error);
      } finally {
        isSteppingRef.current = false;
      }
    },
    [pausePlayback, seekPlayback],
  );

  const onStepPrevious = useCallback(() => {
    if (!canStepPrevious) {
      return;
    }
    void seekTo(
      async () =>
        (await getMessageAtTime(topic.name, subtractTime(prevAnchorTime, ONE_NANOSECOND)))
          ?.receiveTime,
    );
  }, [canStepPrevious, getMessageAtTime, prevAnchorTime, seekTo, topic]);

  const onStepNext = useCallback(() => {
    if (!canStepNext) {
      return;
    }
    void seekTo(async () => {
      const iterator = getBatchIterator(topic.name, {
        start: addTime(currentTime, ONE_NANOSECOND),
      });
      for await (const result of iterator ?? []) {
        if (
          result.type === "message-event" &&
          compare(result.msgEvent.receiveTime, currentTime) > 0
        ) {
          return result.msgEvent.receiveTime;
        }
      }
      return undefined;
    });
  }, [canStepNext, currentTime, getBatchIterator, seekTo, topic]);

  return {
    topicRosPath,
    topic,
    rootStructureItem,
    baseItem,
    diffItem,
    expansion,
    setExpansion,
    nodes,
    canExpandAll,
    onTopicPathChange,
    onDiffTopicPathChange,
    onToggleDiff,
    onToggleExpandAll,
    isExpanded,
    onToggleExpand,
    canStep,
    canStepPrevious,
    canStepNext,
    onStepPrevious,
    onStepNext,
  };
}
