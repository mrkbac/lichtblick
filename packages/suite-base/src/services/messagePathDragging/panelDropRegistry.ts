// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  DraggedMessagePath,
  MessagePathDropConfig,
} from "@lichtblick/suite-base/components/PanelExtensionAdapter";

// Lets code outside a panel (e.g. the topic list) "drop" message paths onto it without dragging.
// ponytail: module-level state, fine while only one layout is mounted at a time.
const dropConfigs = new Map<string, MessagePathDropConfig>();
const pendingDrops = new Map<string, readonly DraggedMessagePath[]>();

function tryDrop(
  config: MessagePathDropConfig | undefined,
  paths: readonly DraggedMessagePath[],
): boolean {
  if (config?.getDropStatus(paths).canDrop !== true) {
    return false;
  }
  config.handleDrop(paths);
  return true;
}

export function setPanelDropConfig(
  panelId: string,
  config: MessagePathDropConfig | undefined,
): void {
  if (!config) {
    dropConfigs.delete(panelId);
    return;
  }
  dropConfigs.set(panelId, config);
  const pending = pendingDrops.get(panelId);
  if (pending && tryDrop(config, pending)) {
    pendingDrops.delete(panelId);
  }
}

/** Drops onto the first panel that accepts the paths. Returns the id of that panel. */
export function dropOnFirstAcceptingPanel(
  panelIds: readonly string[],
  paths: readonly DraggedMessagePath[],
): string | undefined {
  return panelIds.find((id) => tryDrop(dropConfigs.get(id), paths));
}

/** Drops onto a panel as soon as it registers a drop config that accepts the paths. */
export function queuePanelDrop(panelId: string, paths: readonly DraggedMessagePath[]): void {
  if (!tryDrop(dropConfigs.get(panelId), paths)) {
    pendingDrops.set(panelId, paths);
  }
}

export function clearPanelDrop(panelId: string): void {
  dropConfigs.delete(panelId);
  pendingDrops.delete(panelId);
}
