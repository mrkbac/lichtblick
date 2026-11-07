// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import type { LayoutNode } from "@lichtblick/suite-base/types/layouts";
import type { SavedProps } from "@lichtblick/suite-base/types/panels";
import {
  MosaicNode,
  isLayoutNode,
  isMosaicNode,
  normalizeLayout,
} from "@lichtblick/suite-base/util/layoutTree";
import { isTabPanel } from "@lichtblick/suite-base/util/tabLayout";

function convert(node: MosaicNode): LayoutNode | undefined {
  if (typeof node === "string") {
    return { panels: [node] };
  }
  const first = node.splitPercentage ?? 50;
  const parts = [
    { tree: convert(node.first), size: first },
    { tree: convert(node.second), size: 100 - first },
  ].filter((part): part is { tree: LayoutNode; size: number } => part.tree != undefined);
  return normalizeLayout({
    direction: node.direction,
    children: parts.map((part) => part.tree),
    sizes: parts.map((part) => part.size),
  });
}

/** Whether a Tab panel config still holds react-mosaic-component tab layouts. */
function hasMosaicTabs(config: Record<string, unknown> | undefined): boolean {
  return (
    Array.isArray(config?.tabs) &&
    config.tabs.some(
      (tab: unknown) =>
        typeof tab === "object" &&
        tab != undefined &&
        "layout" in tab &&
        tab.layout != undefined &&
        !isLayoutNode(tab.layout),
    )
  );
}

/**
 * Convert a layout saved by react-mosaic-component (binary splits) into a layout tree, including
 * the layout in each tab of a Tab panel. Tab layouts that are malformed (e.g. from a hand-edited
 * file) become empty tabs.
 */
export function migrateMosaicLayout(data: LayoutData): LayoutData {
  const legacy: unknown = data.layout;
  const tabIds = Object.keys(data.configById).filter(
    (id) => isTabPanel(id) && hasMosaicTabs(data.configById[id]),
  );
  if (!isMosaicNode(legacy) && tabIds.length === 0) {
    // Drop a malformed tree (e.g. from a hand-edited file) instead of failing on it later.
    return legacy == undefined || isLayoutNode(legacy) ? data : { ...data, layout: undefined };
  }

  const configById: SavedProps = { ...data.configById };
  for (const id of tabIds) {
    const config = configById[id]!;
    const tabs = (config.tabs as unknown[]).flatMap((rawTab, index) => {
      if (typeof rawTab !== "object" || rawTab == undefined) {
        return [];
      }
      const { title, layout } = rawTab as { title?: unknown; layout?: unknown };
      const tree = isMosaicNode(layout)
        ? convert(layout)
        : isLayoutNode(layout)
          ? layout
          : undefined;
      return [
        {
          title: typeof title === "string" ? title : `${index + 1}`,
          ...(tree != undefined ? { layout: tree } : {}),
        },
      ];
    });
    configById[id] = { ...config, tabs };
  }

  const layout = isMosaicNode(legacy) ? convert(legacy) : isLayoutNode(legacy) ? legacy : undefined;
  return { ...data, layout, configById };
}
