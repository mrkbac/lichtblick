// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { SettingsTreeNodeAction } from "@lichtblick/suite";
import { lineColors } from "@lichtblick/suite-base/util/plotColors";

/**
 * Assigns default colors to series paths that don't have a color set.
 * Only applies to object paths with an optional color property.
 */
export function assignDefaultColorsToSeries<T extends { color?: string }>(paths: T[]): void {
  paths.forEach((path, idx) => {
    path.color ??= lineColors[idx % lineColors.length];
  });
}

/** Moves `arr[from]` to index `to` in place. No-op when either index is out of range. */
export function moveItem(arr: unknown[], from: number, to: number): void {
  if (from === to || !(from >= 0 && from < arr.length && to >= 0 && to < arr.length)) {
    return;
  }
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
}

/**
 * Reorders an item in a paths array from sourceIndex to targetIndex.
 * Used by panels that support reordering of series/paths.
 */
export function handleReorderSeriesAction<T extends { paths: unknown[] }>(
  draft: T,
  sourceIndex: number,
  targetIndex: number,
): void {
  moveItem(draft.paths, sourceIndex, targetIndex);
}

/** "move-up"/"move-down" settings-tree actions for the item at `index` of a `count`-long list. */
export function moveUpDownActions(
  index: number,
  count: number,
  labels: { up: string; down: string } = { up: "Move up", down: "Move down" },
): SettingsTreeNodeAction[] {
  const actions: SettingsTreeNodeAction[] = [];
  if (index > 0) {
    actions.push({ type: "action", id: "move-up", label: labels.up, icon: "MoveUp" });
  }
  if (index < count - 1) {
    actions.push({ type: "action", id: "move-down", label: labels.down, icon: "MoveDown" });
  }
  return actions;
}
