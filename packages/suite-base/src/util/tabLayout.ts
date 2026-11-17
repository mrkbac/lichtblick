// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";

import { pushAll } from "@lichtblick/den/collection";
import type { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import type { LayoutNode } from "@lichtblick/suite-base/types/layouts";
import type { PanelConfig } from "@lichtblick/suite-base/types/panels";
import { getPanelIdForType, getPanelTypeFromId } from "@lichtblick/suite-base/util/layout";
import {
  getGroups,
  getPanelIds,
  isLayoutNode,
  mapGroups,
  normalizeLayout,
  setActivePanel,
} from "@lichtblick/suite-base/util/layoutTree";

/**
 * The Tab panel holds a whole layout per tab, so a tab can be split. It is the only kind of tab:
 * panels stacked onto each other become a Tab panel (see `normalizeTabs`). The tab layouts live in
 * its config, so the layout tree stays flat and every panel's config stays in `configById`.
 */
export const TAB_PANEL_TYPE = "Tab";

export type TabConfig = { title: string; layout?: LayoutNode };
export type TabPanelConfig = { activeTabIdx: number; tabs: TabConfig[]; isWindow?: boolean };

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
    return [];
  }
  return tabs.flatMap((tab: unknown) => {
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

/** The panels on screen: the root tree and, recursively, the shown tab of each Tab panel. */
export function getVisiblePanelIds(data: TreeData): string[] {
  const result: string[] = [];
  const visit = (tree: LayoutNode | undefined, ancestors: readonly string[]) => {
    for (const group of getGroups(tree)) {
      const id =
        group.active != undefined && group.panels.includes(group.active)
          ? group.active
          : group.panels[0];
      if (id == undefined) {
        continue;
      }
      result.push(id);
      // A hand-edited file could nest a Tab panel in itself.
      if (isTabPanel(id) && !ancestors.includes(id)) {
        const config = data.configById[id];
        visit(getTabs(config)[getActiveTabIndex(config)]?.layout, [...ancestors, id]);
      }
    }
  };
  visit(data.layout, []);
  return result;
}

/**
 * The panel whose settings to show instead of `fromId`, which is nothing, a panel that went off
 * screen, or a Tab panel (it has no settings of its own): the first panel of the tab shown in the
 * innermost Tab panel around `fromId` (or `fromId` itself) that is on screen, else the first panel
 * on screen. Content panels win over Tab panels; an empty tab yields its Tab panel.
 */
export function getFallbackPanelId(
  data: TreeData,
  fromId: string | undefined,
  hidden: ReadonlySet<string> = new Set(),
): string | undefined {
  const first = (tree: LayoutNode | undefined) => {
    const ids = getVisiblePanelIds({ ...data, layout: tree }).filter((id) => !hidden.has(id));
    return ids.find((id) => !isTabPanel(id)) ?? ids[0];
  };
  const visible = getVisiblePanelIds(data);
  const tabPanelIds =
    fromId == undefined
      ? []
      : [
          ...(findLayoutTree(data, fromId)?.location.ancestors ?? []),
          ...(isTabPanel(fromId) ? [fromId] : []),
        ];
  const tabPanelId = tabPanelIds.reverse().find((id) => visible.includes(id) && !hidden.has(id));
  if (tabPanelId != undefined) {
    return first(findActiveTabTree(data, tabPanelId)?.tree) ?? tabPanelId;
  }
  return first(data.layout);
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

/**
 * The tabs of a Tab panel and which of them is shown. Empty tabs stay: they show the panel picker
 * until filled or closed.
 */
function tabsAndActive(config: PanelConfig | undefined): { tabs: TabConfig[]; active: number } {
  return { tabs: getTabs(config), active: getActiveTabIndex(config) };
}

function normalizeTabsOnce<T extends TreeData>(data: T): T {
  let result = data;
  for (const { location } of getLayoutTrees(data)) {
    const tree = getLayoutTree(result, location);
    if (tree == undefined) {
      continue;
    }
    const configs: Record<string, PanelConfig> = {};
    const { configById } = result;
    const mapped = mapGroups(tree, (group) => {
      if (group.panels.length === 1) {
        const id = group.panels[0]!;
        if (!isTabPanel(id)) {
          return group;
        }
        // A monitor needs a stable container even when empty or holding just one panel.
        if (configById[id]?.isWindow === true) {
          return group;
        }
        const tabs = getTabs(configById[id]);
        // A Tab panel with one tab left becomes that tab's layout; one with none goes away.
        return tabs.length <= 1 ? tabs[0]?.layout : group;
      }
      // Panels stacked onto each other become one Tab panel with a tab per panel. Stacked Tab
      // panels contribute their tabs; the first of them is kept.
      const tabPanelId = group.panels.find(isTabPanel) ?? getPanelIdForType(TAB_PANEL_TYPE);
      const shownId = group.active ?? group.panels[0];
      const tabs: TabConfig[] = [];
      let activeTabIdx = 0;
      for (const id of group.panels) {
        if (isTabPanel(id)) {
          const merged = tabsAndActive(configById[id] ?? configs[id]);
          if (id === shownId) {
            activeTabIdx = tabs.length + merged.active;
          }
          pushAll(tabs, merged.tabs);
        } else {
          if (id === shownId) {
            activeTabIdx = tabs.length;
          }
          tabs.push({ title: "", layout: { panels: [id] } });
        }
      }
      configs[tabPanelId] = { ...configById[tabPanelId], tabs, activeTabIdx };
      return { panels: [tabPanelId] };
    });
    result = { ...result, configById: { ...result.configById, ...configs } };
    result = setLayoutTree(result, location, mapped);
  }
  return _.isEqual(result, data) ? data : result;
}

/**
 * Keep tabs in one shape: panels stacked in a group become a Tab panel with a tab per panel, and a
 * Tab panel with a single tab left is replaced by that tab's layout. Empty tabs stay until closed.
 * Configs of panels that leave the layout are not removed here.
 */
export function normalizeTabs<T extends TreeData>(data: T): T {
  let result = data;
  // Each pass can uncover more to do (e.g. a tab whose last panel was a Tab panel); a few suffice.
  for (let pass = 0; pass < 8; pass++) {
    const next = normalizeTabsOnce(result);
    if (next === result) {
      break;
    }
    result = next;
  }
  return result;
}

/** Bring `panelId` to front: its tab in its group, and every tab it is nested in. */
export function showPanel<T extends TreeData>(data: T, panelId: string): T {
  let result = data;
  let id = panelId;
  // Bounded by the nesting depth; the guard only protects against a malformed layout.
  for (let depth = 0; depth < 16; depth++) {
    const found = findLayoutTree(result, id);
    if (found == undefined) {
      break;
    }
    result = setLayoutTree(result, found.location, setActivePanel(found.tree, id));
    const { location } = found;
    if (location.tabPanelId == undefined) {
      break;
    }
    const config = result.configById[location.tabPanelId];
    if (config?.activeTabIdx !== location.tabIndex) {
      result = {
        ...result,
        configById: {
          ...result.configById,
          [location.tabPanelId]: { ...config, activeTabIdx: location.tabIndex },
        },
      };
    }
    id = location.tabPanelId;
  }
  return result;
}
