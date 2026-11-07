// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";

import type { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import type { LayoutNode } from "@lichtblick/suite-base/types/layouts";
import type { PanelConfig } from "@lichtblick/suite-base/types/panels";
import { getPanelTypeFromId } from "@lichtblick/suite-base/util/layout";
import { getPanelIds, isLayoutNode, normalizeLayout } from "@lichtblick/suite-base/util/layoutTree";

/**
 * The Tab panel holds a whole layout per tab. The tab layouts live in its config, so the layout
 * tree of the selected layout stays flat and every panel's config stays in `configById`.
 */
export const TAB_PANEL_TYPE = "Tab";

export type TabConfig = { title: string; layout?: LayoutNode };
export type TabPanelConfig = { activeTabIdx: number; tabs: TabConfig[] };

export const DEFAULT_TAB_PANEL_CONFIG: TabPanelConfig = {
  activeTabIdx: 0,
  tabs: [{ title: "1" }],
};

type TreeData = Pick<LayoutData, "layout" | "configById">;

export function isTabPanel(panelId: string): boolean {
  return getPanelTypeFromId(panelId) === TAB_PANEL_TYPE;
}

/** The tabs of a Tab panel config, skipping malformed entries (configs come from saved files). */
export function getTabs(config: PanelConfig | undefined): TabConfig[] {
  const tabs: unknown = config?.tabs;
  if (!Array.isArray(tabs)) {
    return DEFAULT_TAB_PANEL_CONFIG.tabs;
  }
  const valid = tabs.flatMap((tab: unknown) => {
    if (typeof tab !== "object" || tab == undefined) {
      return [];
    }
    const { title, layout } = tab as Record<string, unknown>;
    return [
      {
        title: typeof title === "string" ? title : "",
        ...(isLayoutNode(layout) ? { layout } : {}),
      },
    ];
  });
  // A Tab panel always has a tab, so panels added to it have somewhere to go.
  return valid.length > 0 ? valid : DEFAULT_TAB_PANEL_CONFIG.tabs;
}

/** Index of the shown tab, within range. */
export function getActiveTabIndex(config: PanelConfig | undefined): number {
  const index = config?.activeTabIdx;
  const count = getTabs(config).length;
  return typeof index === "number" && index >= 0 && index < count ? Math.floor(index) : 0;
}

/** Where a layout tree lives: the root of the layout, or one tab of a Tab panel. */
export type TreeLocation =
  | { tabPanelId?: undefined; ancestors: readonly string[] }
  | { tabPanelId: string; tabIndex: number; ancestors: readonly string[] };

/**
 * The root tree and, recursively, the tree of every tab of every Tab panel in it. `ancestors`
 * lists the Tab panels a tree is nested in, outermost first.
 */
export function getLayoutTrees(
  data: TreeData,
): { location: TreeLocation; tree: LayoutNode | undefined }[] {
  const result: { location: TreeLocation; tree: LayoutNode | undefined }[] = [];
  const visit = (tree: LayoutNode | undefined, location: TreeLocation) => {
    result.push({ location, tree });
    for (const id of getPanelIds(tree)) {
      // A hand-edited file could nest a Tab panel in itself.
      if (isTabPanel(id) && !location.ancestors.includes(id)) {
        const ancestors = [...location.ancestors, id];
        getTabs(data.configById[id]).forEach((tab, tabIndex) => {
          visit(tab.layout, { tabPanelId: id, tabIndex, ancestors });
        });
      }
    }
  };
  visit(data.layout, { ancestors: [] });
  return result;
}

/** Every panel in the layout, including the panels inside tabs. */
export function getAllPanelIds(data: TreeData): string[] {
  return getLayoutTrees(data).flatMap(({ tree }) => getPanelIds(tree));
}

/** The tree holding `panelId`, if any. */
export function findLayoutTree(
  data: TreeData,
  panelId: string,
): { location: TreeLocation; tree: LayoutNode } | undefined {
  const found = getLayoutTrees(data).find(({ tree }) => getPanelIds(tree).includes(panelId));
  return found?.tree == undefined ? undefined : { location: found.location, tree: found.tree };
}

/** The tree of the shown tab of `tabPanelId`, if that Tab panel is in the layout. */
export function findActiveTabTree(
  data: TreeData,
  tabPanelId: string,
): { location: TreeLocation; tree: LayoutNode | undefined } | undefined {
  const tabIndex = getActiveTabIndex(data.configById[tabPanelId]);
  return getLayoutTrees(data).find(
    ({ location }) => location.tabPanelId === tabPanelId && location.tabIndex === tabIndex,
  );
}

export function getLayoutTree(data: TreeData, location: TreeLocation): LayoutNode | undefined {
  if (location.tabPanelId == undefined) {
    return data.layout;
  }
  return getTabs(data.configById[location.tabPanelId])[location.tabIndex]?.layout;
}

/** Replace the tree at `location` (normalized). Keeps `data` when nothing changes. */
export function setLayoutTree<T extends TreeData>(
  data: T,
  location: TreeLocation,
  tree: LayoutNode | undefined,
): T {
  const normalized = normalizeLayout(tree);
  if (_.isEqual(normalized, getLayoutTree(data, location))) {
    return data;
  }
  if (location.tabPanelId == undefined) {
    return { ...data, layout: normalized };
  }
  const { tabPanelId, tabIndex } = location;
  const config = data.configById[tabPanelId] ?? DEFAULT_TAB_PANEL_CONFIG;
  const tabs = getTabs(config).slice();
  const tab = _.omit(tabs[tabIndex] ?? { title: `${tabIndex + 1}` }, "layout");
  tabs[tabIndex] = normalized == undefined ? tab : { ...tab, layout: normalized };
  return {
    ...data,
    configById: { ...data.configById, [tabPanelId]: { ...config, tabs } },
  };
}

/** Apply `fn` to every tree of the layout, the root and every tab. */
export function mapLayoutTrees<T extends TreeData>(
  data: T,
  fn: (tree: LayoutNode | undefined) => LayoutNode | undefined,
): T {
  return getLayoutTrees(data).reduce(
    (result, { location }) => setLayoutTree(result, location, fn(getLayoutTree(result, location))),
    data,
  );
}
