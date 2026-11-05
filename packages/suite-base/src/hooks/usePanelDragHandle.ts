// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LocalSelectionTransfer, PanelTransfer } from "dockview-react";
import { useCallback, useContext } from "react";

import { DockPanelContext } from "@lichtblick/suite-base/components/DockPanelContext";

/**
 * Ref callback that makes an element (such as a panel toolbar) a drag handle for its panel. The
 * drag carries the same data as a dockview tab, so the layout handles the drop like a tab drag:
 * drop on an edge to split, on the middle of a panel to stack them as tabs.
 */
export function usePanelDragHandle(
  onDragStart?: () => void,
): ((element: HTMLElement | null) => (() => void) | undefined) | undefined {
  const dock = useContext(DockPanelContext);

  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (element == undefined || dock == undefined) {
        return undefined;
      }
      const { api, containerApi } = dock;
      const transfer = LocalSelectionTransfer.getInstance<PanelTransfer>();

      const handleDragStart = (event: DragEvent) => {
        // The only panel of a layout has nowhere to go.
        if (containerApi.totalPanels <= 1) {
          event.preventDefault();
          return;
        }
        transfer.setData(
          [new PanelTransfer(containerApi.id, api.group.id, api.id)],
          PanelTransfer.prototype,
        );
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          // Firefox only starts a drag that carries data.
          event.dataTransfer.setData("text/plain", api.title ?? api.id);
        }
        onDragStart?.();
      };
      const handleDragEnd = () => {
        transfer.clearData(PanelTransfer.prototype);
      };

      element.draggable = true;
      element.addEventListener("dragstart", handleDragStart);
      element.addEventListener("dragend", handleDragEnd);
      return () => {
        element.draggable = false;
        element.removeEventListener("dragstart", handleDragStart);
        element.removeEventListener("dragend", handleDragEnd);
      };
    },
    [dock, onDragStart],
  );

  return dock == undefined ? undefined : ref;
}
