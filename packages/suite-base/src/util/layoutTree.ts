// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type {
  LayoutDropPosition,
  LayoutGroup,
  LayoutNode,
  LayoutSplit,
} from "@lichtblick/suite-base/types/layouts";

export function isLayoutGroup(node: LayoutNode): node is LayoutGroup {
  return "panels" in node;
}

/** All panel ids in layout order (tabs in tab order). */
export function getPanelIds(node: LayoutNode | undefined): string[] {
  if (node == undefined) {
    return [];
  }
  if (isLayoutGroup(node)) {
    return [...node.panels];
  }
  return node.children.flatMap(getPanelIds);
}

/** All groups in layout order. */
export function getGroups(node: LayoutNode | undefined): LayoutGroup[] {
  if (node == undefined) {
    return [];
  }
  return isLayoutGroup(node) ? [node] : node.children.flatMap(getGroups);
}

export function findGroup(node: LayoutNode | undefined, panelId: string): LayoutGroup | undefined {
  return getGroups(node).find((group) => group.panels.includes(panelId));
}

function equalSizes(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

function sizesOf(split: LayoutSplit): number[] {
  const { sizes, children } = split;
  if (sizes?.length !== children.length || sizes.some((size) => !(size > 0))) {
    return equalSizes(children.length);
  }
  const total = sizes.reduce((a, b) => a + b, 0);
  return sizes.map((size) => (size / total) * 100);
}

/**
 * Bring a tree into its canonical form: no empty groups, no splits with fewer than two children,
 * no split nested directly in a split of the same direction, sizes in percent, and a valid active
 * tab. Returns undefined for a layout without panels.
 */
export function normalizeLayout(node: LayoutNode | undefined): LayoutNode | undefined {
  if (node == undefined) {
    return undefined;
  }
  if (isLayoutGroup(node)) {
    const panels = [...new Set(node.panels.filter((id) => id !== ""))];
    if (panels.length === 0) {
      return undefined;
    }
    const active =
      node.active != undefined && panels.includes(node.active) ? node.active : undefined;
    return active == undefined || active === panels[0] ? { panels } : { panels, active };
  }

  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  const oldSizes = sizesOf(node);
  node.children.forEach((child, index) => {
    const normalized = normalizeLayout(child);
    const size = oldSizes[index] ?? 0;
    if (normalized == undefined) {
      return;
    }
    if (!isLayoutGroup(normalized) && normalized.direction === node.direction) {
      // Same direction: splice the grandchildren in, scaled to the child's share.
      const childSizes = sizesOf(normalized);
      normalized.children.forEach((grandchild, grandIndex) => {
        children.push(grandchild);
        sizes.push(((childSizes[grandIndex] ?? 0) * size) / 100);
      });
      return;
    }
    children.push(normalized);
    sizes.push(size);
  });

  if (children.length === 0) {
    return undefined;
  }
  if (children.length === 1) {
    return children[0];
  }
  const total = sizes.reduce((a, b) => a + b, 0);
  return {
    direction: node.direction,
    children,
    sizes: sizes.map((size) => Math.round((size / total) * 10000) / 100),
  };
}

function mapGroups(
  node: LayoutNode,
  fn: (group: LayoutGroup) => LayoutNode | undefined,
): LayoutNode | undefined {
  if (isLayoutGroup(node)) {
    return fn(node);
  }
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  const oldSizes = sizesOf(node);
  node.children.forEach((child, index) => {
    const mapped = mapGroups(child, fn);
    if (mapped != undefined) {
      children.push(mapped);
      sizes.push(oldSizes[index] ?? 0);
    }
  });
  return { direction: node.direction, children, sizes };
}

export function removePanels(
  node: LayoutNode | undefined,
  panelIds: readonly string[],
): LayoutNode | undefined {
  if (node == undefined) {
    return undefined;
  }
  return normalizeLayout(
    mapGroups(node, (group) => ({
      ...group,
      panels: group.panels.filter((id) => !panelIds.includes(id)),
    })),
  );
}

export function replacePanel(
  node: LayoutNode | undefined,
  oldId: string,
  newId: string,
): LayoutNode | undefined {
  if (node == undefined) {
    return undefined;
  }
  return normalizeLayout(
    mapGroups(node, (group) => ({
      panels: group.panels.map((id) => (id === oldId ? newId : id)),
      active: group.active === oldId ? newId : group.active,
    })),
  );
}

function wrap(
  existing: LayoutNode,
  added: LayoutNode,
  position: Exclude<LayoutDropPosition, "center">,
): LayoutSplit {
  const direction = position === "left" || position === "right" ? "row" : "column";
  const before = position === "left" || position === "top";
  return { direction, children: before ? [added, existing] : [existing, added], sizes: [50, 50] };
}

/**
 * Insert `panelId` next to the group holding `targetPanelId` ("center" adds it as a tab), or along
 * an edge of the whole layout when there is no target.
 */
export function insertPanel(
  node: LayoutNode | undefined,
  panelId: string,
  position: LayoutDropPosition,
  targetPanelId?: string,
): LayoutNode {
  const added: LayoutGroup = { panels: [panelId] };
  const rest = removePanels(node, [panelId]);
  if (rest == undefined) {
    return added;
  }
  const target = targetPanelId != undefined ? findGroup(rest, targetPanelId) : undefined;
  if (target == undefined) {
    if (position === "center") {
      return isLayoutGroup(rest)
        ? { panels: [...rest.panels, panelId], active: panelId }
        : normalizeLayout(wrap(rest, added, "right"))!;
    }
    return normalizeLayout(wrap(rest, added, position))!;
  }
  return normalizeLayout(
    mapGroups(rest, (group) => {
      if (group !== target) {
        return group;
      }
      if (position === "center") {
        return { panels: [...group.panels, panelId], active: panelId };
      }
      return wrap(group, added, position);
    }),
  )!;
}

/** Move `panelIds` into the group holding `targetPanelId` as tabs. */
export function groupPanels(
  node: LayoutNode | undefined,
  targetPanelId: string,
  panelIds: readonly string[],
): LayoutNode | undefined {
  let result = node;
  for (const id of panelIds) {
    if (id !== targetPanelId) {
      result = insertPanel(result, id, "center", targetPanelId);
    }
  }
  return result == undefined ? undefined : setActivePanel(result, targetPanelId);
}

export function setActivePanel(node: LayoutNode, panelId: string): LayoutNode {
  return normalizeLayout(
    mapGroups(node, (group) =>
      group.panels.includes(panelId) ? { ...group, active: panelId } : group,
    ),
  )!;
}

/**
 * The panel next to `panelId` in its parent split (the one after it, or before it when it is
 * last), as long as that neighbour is a single group.
 */
export function getSiblingGroup(
  node: LayoutNode | undefined,
  panelId: string,
): LayoutGroup | undefined {
  if (node == undefined || isLayoutGroup(node)) {
    return undefined;
  }
  const index = node.children.findIndex((child) => getPanelIds(child).includes(panelId));
  const child = node.children[index];
  if (child == undefined) {
    return undefined;
  }
  if (!isLayoutGroup(child)) {
    return getSiblingGroup(child, panelId);
  }
  const sibling = node.children[index + 1] ?? node.children[index - 1];
  return sibling != undefined && isLayoutGroup(sibling) ? sibling : undefined;
}

function stripSizes(node: LayoutNode): unknown {
  if (isLayoutGroup(node)) {
    return [node.panels, node.active ?? node.panels[0]];
  }
  return [node.direction, node.children.map(stripSizes)];
}

/** Same panels in the same arrangement; sizes may differ by up to `sizeTolerance` percent. */
export function layoutsEqual(
  a: LayoutNode | undefined,
  b: LayoutNode | undefined,
  sizeTolerance = 0.5,
): boolean {
  if (a == undefined || b == undefined) {
    return a === b;
  }
  if (JSON.stringify(stripSizes(a)) !== JSON.stringify(stripSizes(b))) {
    return false;
  }
  if (isLayoutGroup(a) || isLayoutGroup(b)) {
    return true;
  }
  const sizesA = sizesOf(a);
  const sizesB = sizesOf(b);
  return a.children.every(
    (child, index) =>
      Math.abs((sizesA[index] ?? 0) - (sizesB[index] ?? 0)) <= sizeTolerance &&
      layoutsEqual(child, b.children[index], sizeTolerance),
  );
}
