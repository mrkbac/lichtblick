// SPDX-License-Identifier: MPL-2.0

import { getPanelData } from "dockview-react";

import { PanelConfig } from "@lichtblick/suite-base/types/panels";
import { getPanelIdForType } from "@lichtblick/suite-base/util/layout";

import { PanelSelection } from "./types";

/** Data type of a panel dragged out of the panel catalog. */
const PANEL_DRAG_TYPE = "application/x-lichtblick-panel";

export function setPanelDragData(dataTransfer: DataTransfer, selection: PanelSelection): void {
  dataTransfer.setData(PANEL_DRAG_TYPE, JSON.stringify(selection) ?? "");
  dataTransfer.effectAllowed = "copy";
}

/** Whether a drag carries a catalog panel. Works during dragover, when the data is still hidden. */
export function isPanelDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  return dataTransfer?.types.includes(PANEL_DRAG_TYPE) ?? false;
}

/** The dragged catalog panel; only readable on drop. */
export function getPanelDragData(
  dataTransfer: DataTransfer | null | undefined,
): PanelSelection | undefined {
  const data = dataTransfer?.getData(PANEL_DRAG_TYPE);
  if (data == undefined || data === "") {
    return undefined;
  }
  try {
    const selection = JSON.parse(data) as Partial<PanelSelection>;
    return typeof selection.type === "string" ? (selection as PanelSelection) : undefined;
  } catch {
    return undefined;
  }
}

/** The panel dropped by a drag: a new one from the catalog, or an existing one moved in the layout. */
export function getDroppedPanel(
  dataTransfer: DataTransfer | null | undefined,
): { id: string; config?: PanelConfig } | undefined {
  const selection = getPanelDragData(dataTransfer);
  if (selection) {
    return { id: getPanelIdForType(selection.type), config: selection.config };
  }
  const id = getPanelData()?.panelId;
  return id != undefined ? { id } : undefined;
}
