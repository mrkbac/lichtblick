// SPDX-License-Identifier: MPL-2.0

import {
  DraggedMessagePath,
  MessagePathDropConfig,
} from "@lichtblick/suite-base/components/PanelExtensionAdapter";

/** True for a dragged topic, or a field of one, whose schema is in `schemas` */
export const hasSchema =
  (schemas: ReadonlySet<string>) =>
  (item: DraggedMessagePath): boolean =>
    item.rootSchemaName != undefined && schemas.has(item.rootSchemaName);

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
