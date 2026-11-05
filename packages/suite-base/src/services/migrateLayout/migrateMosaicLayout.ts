// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import type { LayoutGroup, LayoutNode } from "@lichtblick/suite-base/types/layouts";
import type { SavedProps } from "@lichtblick/suite-base/types/panels";
import { PANEL_TITLE_CONFIG_KEY, getPanelTypeFromId } from "@lichtblick/suite-base/util/layout";
import { getGroups, isLayoutGroup, normalizeLayout } from "@lichtblick/suite-base/util/layoutTree";

/** Panel type of the retired Tab panel, which nested a whole layout per tab. */
const LEGACY_TAB_PANEL_TYPE = "Tab";

/** Layout tree of react-mosaic-component, which layouts were saved in before. */
type MosaicNode =
  | string
  | {
      direction: "row" | "column";
      first: MosaicNode;
      second: MosaicNode;
      splitPercentage?: number;
    };

type LegacyTabConfig = { activeTabIdx?: number; tabs?: { title?: string; layout?: MosaicNode }[] };

function isMosaicNode(value: unknown): value is MosaicNode {
  return (
    typeof value === "string" ||
    (typeof value === "object" && value != undefined && "first" in value && "second" in value)
  );
}

/**
 * Convert a layout saved by react-mosaic-component (binary splits, nested Tab panels) into a layout
 * tree. Tab panels become groups of tabs: the active tab's arrangement is kept, and the panels of
 * the other tabs are stacked as tabs onto the groups in the same position (so tabs with the same
 * arrangement line up). Every panel and its config is kept; only the Tab panels go away.
 */
export function migrateMosaicLayout(data: LayoutData): LayoutData {
  const legacy: unknown = data.layout;
  const hasTabConfigs = Object.keys(data.configById).some(
    (id) => getPanelTypeFromId(id) === LEGACY_TAB_PANEL_TYPE,
  );
  if (!isMosaicNode(legacy) && !hasTabConfigs) {
    return data;
  }

  const configById: SavedProps = { ...data.configById };

  function convert(node: MosaicNode): LayoutNode | undefined {
    if (typeof node === "string") {
      return getPanelTypeFromId(node) === LEGACY_TAB_PANEL_TYPE
        ? convertTabPanel(node)
        : { panels: [node] };
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

  function convertTabPanel(tabPanelId: string): LayoutNode | undefined {
    const config = configById[tabPanelId] as LegacyTabConfig | undefined;
    delete configById[tabPanelId];
    const tabs = (config?.tabs ?? []).flatMap((tab, index) => {
      const tree = tab.layout != undefined ? convert(tab.layout) : undefined;
      return tree == undefined ? [] : [{ title: tab.title, tree, index }];
    });
    const base = tabs.find((tab) => tab.index === (config?.activeTabIdx ?? 0)) ?? tabs[0];
    if (base == undefined) {
      return undefined;
    }

    // A tab holding a single panel shows its tab title, unless the panel has its own title.
    for (const { title, tree } of tabs) {
      if (isLayoutGroup(tree) && tree.panels.length === 1 && title) {
        const panelId = tree.panels[0]!;
        const panelConfig = configById[panelId] ?? {};
        if (panelConfig[PANEL_TITLE_CONFIG_KEY] == undefined) {
          configById[panelId] = { ...panelConfig, [PANEL_TITLE_CONFIG_KEY]: title };
        }
      }
    }

    const result = structuredClone(base.tree);
    const targets: LayoutGroup[] = getGroups(result);
    const activePanels = targets.map((group) => group.active ?? group.panels[0]);
    for (const group of targets) {
      group.panels = [];
    }
    for (const { tree } of tabs) {
      getGroups(tree).forEach((group, index) => {
        targets[index % targets.length]!.panels.push(...group.panels);
      });
    }
    targets.forEach((group, index) => {
      group.active = activePanels[index];
    });
    return normalizeLayout(result);
  }

  const layout = isMosaicNode(legacy) ? convert(legacy) : data.layout;
  // Tab panels that are no longer in the layout only leave orphaned configs behind.
  for (const id of Object.keys(configById)) {
    if (getPanelTypeFromId(id) === LEGACY_TAB_PANEL_TYPE) {
      delete configById[id];
    }
  }
  return { ...data, layout, configById };
}
