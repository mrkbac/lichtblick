// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useMemo } from "react";

import { parseMessagePath } from "@lichtblick/message-path";
import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import { getTopicToSchemaNameMap } from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import { DraggedMessagePath } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { useMessagePathDrag } from "@lichtblick/suite-base/services/messagePathDragging";

const NO_ITEM: DraggedMessagePath = {
  path: "",
  rootSchemaName: undefined,
  isTopic: false,
  isLeaf: true,
  topicName: "",
};

/**
 * Makes a series row (e.g. a Plot legend row) a drag source, so the series can be dropped onto any
 * panel that accepts message paths. The panel the row lives in ignores the drop.
 *
 * `dragRef` is undefined when there is nothing to drag (no path, or a value that isn't a message
 * path such as a reference line constant).
 */
export function useSeriesDrag(pathValue: string | undefined): {
  dragRef: ((element: HTMLElement | null) => (() => void) | undefined) | undefined;
  isDragging: boolean;
} {
  const { id: panelId } = usePanelContext();
  const topicName = useMemo(
    () =>
      // A bare number is a Plot reference line, not a message path.
      pathValue && Number.isNaN(Number.parseFloat(pathValue))
        ? parseMessagePath(pathValue)?.topicName
        : undefined,
    [pathValue],
  );
  const rootSchemaName = useMessagePipeline((ctx) =>
    topicName != undefined ? getTopicToSchemaNameMap(ctx)[topicName] : undefined,
  );
  const item = useMemo<DraggedMessagePath | undefined>(
    () =>
      pathValue && topicName
        ? // ponytail: a series a panel already plots is a plottable field, so it counts as a leaf.
          {
            path: pathValue,
            rootSchemaName,
            isTopic: false,
            isLeaf: true,
            topicName,
          }
        : undefined,
    [pathValue, rootSchemaName, topicName],
  );
  const { dragRef, isDragging } = useMessagePathDrag({
    item: item ?? NO_ITEM,
    selected: false,
    sourcePanelId: panelId,
  });
  return { dragRef: item ? dragRef : undefined, isDragging };
}
