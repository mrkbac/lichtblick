// SPDX-License-Identifier: MPL-2.0

import { RefObject, useCallback, useEffect } from "react";

import { useLatest } from "@lichtblick/hooks";
import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import { MessagePipelineContext } from "@lichtblick/suite-base/components/MessagePipeline/types";
import { findShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

import { TOPIC_LIST_SHORTCUTS } from "./shortcuts";
import { useTopicMessageNavigation } from "./useTopicMessageNavigation";

/**
 * N / Shift+N step through `topicName`'s messages while focus is inside `containerRef` (the Topics
 * list). The list owns the keys there: they don't reach app-wide listeners such as State
 * Transitions' N. Lives at list level, so scrolling the selected row out of view keeps the keys.
 */
export function SelectedTopicKeys({
  topicName,
  containerRef,
}: {
  topicName: string;
  containerRef: RefObject<HTMLElement | null>;
}): undefined {
  const isTopicSubscribed = useMessagePipeline(
    useCallback(
      (ctx: MessagePipelineContext) => ctx.subscriptions.some((sub) => sub.topic === topicName),
      [topicName],
    ),
  );
  const navigation = useTopicMessageNavigation({ topicName, selected: true, isTopicSubscribed });
  const latest = useLatest({ navigation, isTopicSubscribed });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = findShortcut(TOPIC_LIST_SHORTCUTS, event);
      if (!shortcut) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const { navigation: nav, isTopicSubscribed: subscribed } = latest.current;
      if (!subscribed || nav.isNavigating) {
        return;
      }
      if (shortcut.id === "topicList.nextMessage" && nav.canNavigateNext) {
        void nav.handleNextMessage();
      } else if (shortcut.id === "topicList.previousMessage" && nav.canNavigatePrevious) {
        void nav.handlePreviousMessage();
      }
    };
    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
    };
  }, [containerRef, latest]);

  return undefined;
}
