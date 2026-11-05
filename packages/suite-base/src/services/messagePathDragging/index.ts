// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import Logger from "@lichtblick/log";
import {
  DraggedMessagePath,
  MessagePathDropConfig,
} from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { MessagePathSelectionContextInternal } from "@lichtblick/suite-base/services/messagePathDragging/MessagePathSelectionProvider";

import { MessagePathDragParams } from "./types";

const log = Logger.getLogger(__filename);

/** Key in the drag data that marks a message path drag. */
const MESSAGE_PATHS_KEY = "lichtblickMessagePaths";
/** Key in the drag data holding the id of the panel the drag started in, if any. */
const SOURCE_PANEL_KEY = "lichtblickSourcePanelId";

/**
 * True when the drag (its `data`) started in the panel `ownerPanelId`. Dropping a
 * series back onto its own panel would only duplicate it, so such drops are ignored. Drags that
 * don't start in a panel (e.g. the topic list) are never self drops.
 */
export function isSelfDrop(
  data: Record<string | symbol, unknown>,
  ownerPanelId: string | undefined,
): boolean {
  const sourcePanelId = data[SOURCE_PANEL_KEY];
  return sourcePanelId != undefined && sourcePanelId === ownerPanelId;
}

function getDraggedItems(data: Record<string | symbol, unknown>): DraggedMessagePath[] | undefined {
  const items = data[MESSAGE_PATHS_KEY];
  return Array.isArray(items) ? (items as DraggedMessagePath[]) : undefined;
}

/**
 * Use this to create a drag source for message paths that can be dropped onto target components
 * that use `useMessagePathDrop()`.
 */
export function useMessagePathDrag({ item, selected, sourcePanelId }: MessagePathDragParams): {
  dragRef: (element: HTMLElement | null) => (() => void) | undefined;
  isDragging: boolean;
  /** Count shown on the drag preview while it is captured; 0 otherwise. */
  draggedItemCount: number;
} {
  const context = useContext(MessagePathSelectionContextInternal);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedItemCount, setDraggedItemCount] = useState(0);

  // Read the latest values when a drag starts, without re-registering the drag source.
  const latest = useRef({ item, selected, context, sourcePanelId });
  latest.current = { item, selected, context, sourcePanelId };

  const dragRef = useCallback((element: HTMLElement | null) => {
    if (element == undefined) {
      return undefined;
    }
    const getItems = () => {
      const selectedItems = latest.current.context?.getSelectedItems();
      // If this item is being dragged but wasn't selected, drag only this item
      return latest.current.selected && selectedItems && selectedItems.length > 0
        ? selectedItems
        : [latest.current.item];
    };
    return draggable({
      element,
      getInitialData: () => ({
        [MESSAGE_PATHS_KEY]: getItems(),
        [SOURCE_PANEL_KEY]: latest.current.sourcePanelId,
      }),
      onGenerateDragPreview: () => {
        // The browser snapshots the element right after this, so the count badge must be in the
        // DOM now; it is hidden again once the drag starts.
        flushSync(() => {
          setDraggedItemCount(getItems().length);
        });
      },
      onDragStart: () => {
        log.debug("Starting message path drag:", getItems());
        setDraggedItemCount(0);
        setIsDragging(true);
      },
      onDrop: () => {
        setIsDragging(false);
      },
    });
  }, []);

  return { dragRef, isDragging, draggedItemCount };
}

/**
 * Use this to create a drop target accepting message paths dragged from components that use
 * `useMessagePathDrag()`.
 */
export function useMessagePathDrop(ownerPanelId?: string): {
  /** True if the target supports dragging (a config is set) and a drag has started */
  isDragging: boolean;
  isOver: boolean;
  isValidTarget: boolean;
  dropMessage: string | undefined;
  connectMessagePathDropTarget: (element: HTMLElement | null) => (() => void) | undefined;
  setMessagePathDropConfig: (config: MessagePathDropConfig | undefined) => void;
} {
  const [config, setMessagePathDropConfig] = useState<MessagePathDropConfig | undefined>();
  const [draggedItems, setDraggedItems] = useState<DraggedMessagePath[] | undefined>();
  const [isOver, setIsOver] = useState(false);

  const configRef = useRef(config);
  configRef.current = config;
  const ownerRef = useRef(ownerPanelId);
  ownerRef.current = ownerPanelId;

  // Track message path drags anywhere, so every target can show whether it accepts them.
  useEffect(
    () =>
      monitorForElements({
        // A panel ignores drags that started in itself, so it shows no drop overlay for them.
        canMonitor: ({ source }) =>
          getDraggedItems(source.data) != undefined && !isSelfDrop(source.data, ownerRef.current),
        onDragStart: ({ source }) => {
          setDraggedItems(getDraggedItems(source.data));
        },
        onDrop: () => {
          setDraggedItems(undefined);
          setIsOver(false);
        },
      }),
    [],
  );

  const connectMessagePathDropTarget = useCallback((element: HTMLElement | null) => {
    if (element == undefined) {
      return undefined;
    }
    const statusOf = (data: Record<string | symbol, unknown>) => {
      const items = getDraggedItems(data);
      return items != undefined && !isSelfDrop(data, ownerRef.current)
        ? configRef.current?.getDropStatus(items)
        : undefined;
    };
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => statusOf(source.data)?.canDrop === true,
      getDropEffect: ({ source }) => (statusOf(source.data)?.effect === "add" ? "copy" : "move"),
      onDragEnter: () => {
        setIsOver(true);
      },
      onDragLeave: () => {
        setIsOver(false);
      },
      onDrop: ({ source }) => {
        setIsOver(false);
        const items = getDraggedItems(source.data);
        if (items != undefined) {
          configRef.current?.handleDrop(items);
        }
      },
    });
  }, []);

  const dropStatus =
    draggedItems != undefined
      ? (config?.getDropStatus(draggedItems) ?? { canDrop: false })
      : undefined;
  const firstItem = draggedItems?.[0];
  const dropMessage =
    dropStatus == undefined || firstItem == undefined || draggedItems == undefined
      ? undefined
      : (dropStatus.message ??
        `${dropStatus.effect === "add" ? "Add" : "View"} ${firstItem.path}` +
          (draggedItems.length > 1 ? ` and ${draggedItems.length - 1} more` : ""));

  return {
    isDragging: draggedItems != undefined && firstItem != undefined,
    isOver: isOver && dropStatus?.canDrop === true,
    isValidTarget: dropStatus?.canDrop === true,
    dropMessage,
    connectMessagePathDropTarget,
    setMessagePathDropConfig,
  };
}
