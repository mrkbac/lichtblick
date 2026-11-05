// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { DockviewDefaultTab, IDockviewPanelHeaderProps, getPanelData } from "dockview-react";
import { DragEvent, useCallback, useEffect, useRef } from "react";

import {
  getPanelDragData,
  isPanelDrag,
} from "@lichtblick/suite-base/components/PanelCatalog/panelDrag";
import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { getPanelIdForType } from "@lichtblick/suite-base/util/layout";

/** How long a drag must rest on a background tab before the tab opens. */
export const TAB_HOVER_ACTIVATE_MS = 500;

/**
 * Drag handlers that call `activate` once a drag has stayed over the element for `delayMs`.
 * Leaving the element (not just moving between its children) or dropping cancels it.
 */
export function useDragHoverActivation(
  activate: () => void,
  delayMs = TAB_HOVER_ACTIVATE_MS,
): {
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: () => void;
} {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activateRef = useRef(activate);
  activateRef.current = activate;

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => cancel, [cancel]);

  const onDragEnter = useCallback(() => {
    timer.current ??= setTimeout(() => {
      timer.current = undefined;
      activateRef.current();
    }, delayMs);
  }, [delayMs]);

  const onDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        cancel();
      }
    },
    [cancel],
  );

  return { onDragEnter, onDragLeave, onDrop: cancel };
}

/**
 * Tab of a panel in a stacked group. Resting a dragged panel on a background tab opens it, so the
 * panel can be dropped into that tab's area. Dropping on a tab adds the panel to the tab's group:
 * a panel from the catalog becomes a new tab, and a panel dragged by its toolbar moves here.
 */
export function PanelTab(props: IDockviewPanelHeaderProps): React.JSX.Element {
  const { api, containerApi } = props;
  const { addPanel } = useCurrentLayoutActions();
  const activate = useCallback(() => {
    if (!api.isVisible) {
      api.setActive();
    }
  }, [api]);
  const { onDragEnter, onDragLeave, onDrop: cancelActivation } = useDragHoverActivation(activate);

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (isPanelDrag(event.dataTransfer) || getPanelData()?.viewId === containerApi.id) {
        event.preventDefault();
      }
    },
    [containerApi],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      cancelActivation();
      const selection = getPanelDragData(event.dataTransfer);
      if (selection != undefined) {
        event.preventDefault();
        addPanel({
          id: getPanelIdForType(selection.type),
          config: selection.config,
          position: "center",
          targetPanelId: api.id,
        });
        return;
      }
      const data = getPanelData();
      const movedPanelId = data?.viewId === containerApi.id ? data.panelId : undefined;
      if (movedPanelId != undefined) {
        // Dockview moves panels dropped on a tab itself in most cases; move the panel only when it
        // didn't.
        setTimeout(() => {
          const panel = containerApi.getPanel(movedPanelId);
          if (panel != undefined && panel.group !== api.group) {
            panel.api.moveTo({ group: api.group, position: "center" });
          }
        }, 0);
      }
    },
    [addPanel, api, cancelActivation, containerApi],
  );

  return (
    <DockviewDefaultTab
      {...props}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    />
  );
}
