// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { GroupviewPanelState, SerializedDockview } from "dockview-react";

import type { LayoutNode } from "@lichtblick/suite-base/types/layouts";
import { isLayoutGroup, normalizeLayout } from "@lichtblick/suite-base/util/layoutTree";

/** Every panel is rendered by this one dockview component; the panel id selects the panel. */
export const PANEL_COMPONENT = "panel";

// Dockview scales a deserialized grid to its container, so any reference size works.
const REFERENCE_SIZE = 1000;

type GridNode = SerializedDockview["grid"]["root"];
/** A group's state in the grid (dockview does not export the type itself). */
type GroupPanelViewState = Exclude<GridNode["data"], GridNode[]>;
type Orientation = SerializedDockview["grid"]["orientation"];

// A branch's orientation is the axis its children are laid out along.
function toOrientation(direction: "row" | "column"): Orientation {
  return (direction === "row" ? "HORIZONTAL" : "VERTICAL") as Orientation;
}

function groupId(panels: readonly string[]): string {
  return `group:${panels[0] ?? ""}`;
}

/**
 * Convert our layout tree into the JSON `DockviewApi.fromJSON` expects. `titleOf` gives each
 * panel's tab title; dockview would otherwise show the panel id.
 */
export function layoutToDockview(
  layout: LayoutNode,
  titleOf: (panelId: string) => string = (panelId) => panelId,
): SerializedDockview {
  const panels: Record<string, GroupviewPanelState> = {};

  // `size` is the node's extent along its parent's axis; `crossSize` along the other one.
  function convert(node: LayoutNode, size: number, crossSize: number): GridNode {
    if (isLayoutGroup(node)) {
      for (const id of node.panels) {
        panels[id] = { id, contentComponent: PANEL_COMPONENT, title: titleOf(id) };
      }
      return {
        type: "leaf",
        size,
        data: {
          id: groupId(node.panels),
          views: node.panels,
          activeView: node.active ?? node.panels[0],
        },
      };
    }
    const sizes = node.sizes ?? node.children.map(() => 100 / node.children.length);
    return {
      type: "branch",
      size,
      data: node.children.map((child, index) =>
        convert(child, ((sizes[index] ?? 0) / 100) * crossSize, size),
      ),
    };
  }

  // The root is always a branch; a single group becomes a branch with one leaf.
  const rootSplit = isLayoutGroup(layout)
    ? { direction: "row" as const, children: [layout], sizes: [100] }
    : layout;
  const root = convert(rootSplit, REFERENCE_SIZE, REFERENCE_SIZE);
  return {
    grid: {
      root,
      width: REFERENCE_SIZE,
      height: REFERENCE_SIZE,
      orientation: toOrientation(rootSplit.direction),
    },
    panels,
  };
}

/** Convert `DockviewApi.toJSON()` back into our layout tree. */
export function dockviewToLayout(json: SerializedDockview): LayoutNode | undefined {
  function convert(node: GridNode, direction: "row" | "column"): LayoutNode {
    if (node.type === "leaf") {
      const data = node.data as GroupPanelViewState;
      return { panels: [...data.views], active: data.activeView };
    }
    const children = node.data as GridNode[];
    const childDirection = direction === "row" ? "column" : "row";
    return {
      direction,
      children: children.map((child) => convert(child, childDirection)),
      sizes: children.map((child) => child.size ?? 0),
    };
  }
  const direction = (json.grid.orientation as string) === "HORIZONTAL" ? "row" : "column";
  return normalizeLayout(convert(json.grid.root, direction));
}
