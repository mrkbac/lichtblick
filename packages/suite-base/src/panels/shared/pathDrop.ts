// SPDX-License-Identifier: MPL-2.0

import { Dispatch, SetStateAction, useEffect } from "react";

import {
  BuiltinPanelExtensionContext,
  DraggedMessagePath,
  MessagePathDropConfig,
} from "@lichtblick/suite-base/components/PanelExtensionAdapter";

/** For a panel showing one path or topic: dropping one item it `accepts` replaces it. */
export function replaceDrop(
  accepts: (item: DraggedMessagePath) => boolean,
  replace: (item: DraggedMessagePath) => void,
): MessagePathDropConfig {
  return {
    getDropStatus: (items) =>
      items.length === 1 && accepts(items[0]!)
        ? { canDrop: true, effect: "replace" }
        : { canDrop: false },
    handleDrop: ([item]) => {
      if (item) {
        replace(item);
      }
    },
  };
}

/**
 * For a panel showing several topics: adds the topics of the dropped items it `accepts` (a field
 * stands for its topic), ignoring the rest.
 */
export function addTopicsDrop(
  accepts: (item: DraggedMessagePath) => boolean,
  add: (topics: string[]) => void,
): MessagePathDropConfig {
  return {
    getDropStatus: (items) =>
      items.some(accepts) ? { canDrop: true, effect: "add" } : { canDrop: false },
    handleDrop: (items) => {
      add([...new Set(items.filter(accepts).map((item) => item.topicName))]);
    },
  };
}

/** For a series panel: adds each dropped field as an enabled series; whole messages are skipped. */
export function addPathsDrop(
  add: (paths: { value: string; enabled: true; timestampMethod: "receiveTime" }[]) => void,
): MessagePathDropConfig {
  return {
    getDropStatus: (items) =>
      items.some((item) => item.isLeaf) ? { canDrop: true, effect: "add" } : { canDrop: false },
    handleDrop: (items) => {
      add(
        items
          .filter((item) => item.isLeaf)
          .map((item) => ({ value: item.path, enabled: true, timestampMethod: "receiveTime" })),
      );
    },
  };
}

/** For a panel showing one field in `config.path`: dropping a field replaces it. */
export function useReplacePathDrop<C extends { path: string }>(
  context: Pick<BuiltinPanelExtensionContext, "unstable_setMessagePathDropConfig">,
  setConfig: Dispatch<SetStateAction<C>>,
): void {
  useEffect(() => {
    context.unstable_setMessagePathDropConfig(
      replaceDrop(
        (item) => item.isLeaf,
        (item) => {
          setConfig((prev) => ({ ...prev, path: item.path }));
        },
      ),
    );
  }, [context, setConfig]);
}
