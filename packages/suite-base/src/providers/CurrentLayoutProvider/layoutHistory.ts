// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";

import {
  LayoutData,
  PanelsActions,
} from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import panelsReducer from "@lichtblick/suite-base/providers/CurrentLayoutProvider/reducers";
import { LayoutDropPosition, LayoutNode } from "@lichtblick/suite-base/types/layouts";
import { PanelConfig } from "@lichtblick/suite-base/types/panels";
import { getPanelIds, isLayoutGroup } from "@lichtblick/suite-base/util/layoutTree";
import {
  findLayoutTree,
  getAllPanelIds,
  getTabs,
  isTabPanel,
} from "@lichtblick/suite-base/util/tabLayout";

/** Undo steps kept per layout. */
export const HISTORY_LIMIT = 100;
/** Edits of the same kind closer together than this become one undo step (typing, slider drags). */
export const COALESCE_MS = 500;

export type Placement = { position: LayoutDropPosition; targetPanelId: string };

type ClosedPanel = {
  id: string;
  /** Configs of the panel and of anything that left the layout with it. */
  configs: Record<string, PanelConfig>;
  /** Best first; the first whose target is still in the layout wins. */
  placements: Placement[];
};

/** Edits with the same key coalesce; discrete edits (close, split, add, …) never do. */
function coalesceKey(action: PanelsActions): string | undefined {
  switch (action.type) {
    case "SAVE_PANEL_CONFIGS":
      return `config:${action.payload.configs.map((c) => c.id).join(",")}`;
    case "SAVE_FULL_PANEL_CONFIG":
      return `full-config:${action.payload.panelType}`;
    case "CHANGE_PANEL_LAYOUT":
    case "SET_GLOBAL_DATA":
    case "OVERWRITE_GLOBAL_DATA":
    case "SET_USER_NODES":
    case "SET_PLAYBACK_CONFIG":
      return action.type;
    default:
      return undefined;
  }
}

/** Panels saving their initial config on mount: flagged defaults, or a panel without any config yet. */
function fillsDefaults(data: LayoutData, action: PanelsActions): boolean {
  return (
    action.type === "SAVE_PANEL_CONFIGS" &&
    (action.payload.fillsDefaults === true ||
      action.payload.configs.every(({ id }) => data.configById[id] == undefined))
  );
}

/**
 * Where a closed panel could go back, best first: as a tab next to one of its former tab mates,
 * else beside its former neighbour in the split. Each placement is anchored on a panel id, so the
 * caller can skip anchors that have since left the layout. Empty means the right edge.
 */
export function reopenPlacements(node: LayoutNode | undefined, panelId: string): Placement[] {
  if (node == undefined) {
    return [];
  }
  if (isLayoutGroup(node)) {
    return node.panels
      .filter((id) => id !== panelId)
      .map((targetPanelId) => ({ position: "center", targetPanelId }));
  }
  const index = node.children.findIndex((child) => getPanelIds(child).includes(panelId));
  const child = node.children[index];
  if (child == undefined) {
    return [];
  }
  if (!isLayoutGroup(child) || child.panels.length > 1) {
    return reopenPlacements(child, panelId);
  }
  const after = node.children[index + 1];
  const neighbour = after ?? node.children[index - 1];
  const row = node.direction === "row";
  // We were before `after`, or after the previous child.
  const position = after ? (row ? "left" : "top") : row ? "right" : "bottom";
  return getPanelIds(neighbour).map((targetPanelId) => ({ position, targetPanelId }));
}

/**
 * Where panel `id` could go back after it is closed from `data`. A panel that filled a whole tab
 * goes back as a tab of its Tab panel, or as a tab next to what is left of that Tab panel.
 */
function closePlacements(data: LayoutData, id: string): Placement[] {
  const found = findLayoutTree(data, id);
  const placements = reopenPlacements(found?.tree, id);
  const tabPanelId = found?.location.tabPanelId;
  // A Stack panel's item doesn't come back as a tab (stacking onto a Stack makes a Tab panel).
  if (placements.length > 0 || tabPanelId == undefined || !isTabPanel(tabPanelId)) {
    return placements;
  }
  const others = getTabs(data.configById[tabPanelId])
    .flatMap((tab) => getPanelIds(tab.layout))
    .filter((other) => other !== id);
  return [tabPanelId, ...others].map((targetPanelId) => ({ position: "center", targetPanelId }));
}

/** One step of a layout's history: the layout data after an edit. */
export type HistoryEntry = {
  data: LayoutData;
  /** Wall-clock time of the step's latest edit. */
  savedAt: number;
  /** The layout as it was opened, when that differs from where its saved history left off. */
  kind?: "opened";
};

/** A layout's history: its steps, oldest first, and the step the layout shows. */
export type HistorySnapshot = { entries: readonly HistoryEntry[]; index: number };

/**
 * Undo/redo history of one layout's data, which is also the history the History tab shows and
 * that is saved per layout. Layout data is immutable, so steps are snapshots that share
 * structure. Data it did not produce itself (e.g. a revert) becomes a new step.
 */
export class LayoutHistory {
  #entries: HistoryEntry[] = [];
  #index = -1;
  #closed: ClosedPanel[] = [];
  #lastKey: string | undefined;
  #lastTime = -Infinity;
  #snapshot: HistorySnapshot = { entries: [], index: -1 };
  #listeners = new Set<() => void>();

  public canUndo(): boolean {
    return this.#index > 0;
  }

  public canRedo(): boolean {
    return this.#index < this.#entries.length - 1;
  }

  /** Stable until the history changes, for useSyncExternalStore. */
  public snapshot(): HistorySnapshot {
    return this.#snapshot;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Starts over with a newly selected layout's saved history. Returns the data to show: the saved
   * current step's data when it equals `data`, so later edits are recognised as this history's.
   */
  public load(saved: HistorySnapshot | undefined, data: LayoutData): LayoutData {
    this.#entries = [...(saved?.entries ?? [])];
    this.#index = Math.min(saved?.index ?? -1, this.#entries.length - 1);
    this.#closed = [];
    this.#lastKey = undefined;
    const current = this.#entries[this.#index];
    if (current != undefined && _.isEqual(current.data, data)) {
      this.#changed();
      return current.data;
    }
    // Changed elsewhere since (or no history yet): the opened state becomes the current step.
    this.#push({ data, savedAt: Date.now(), kind: "opened" });
    this.#changed();
    return data;
  }

  /**
   * Applies `action` to `data` and records the step. Returns the new data, or undefined when the
   * action changed nothing.
   */
  public apply(data: LayoutData, action: PanelsActions, now: number): LayoutData | undefined {
    const next = panelsReducer(data, action);
    if (_.isEqual(data, next)) {
      return undefined;
    }
    this.sync(data);
    if (fillsDefaults(data, action)) {
      // Fold into the current step: no undo step to get stuck on (the panel would save its
      // defaults again right away), and redo stays intact when undo remounts a panel.
      this.#entries[this.#index] = { ...this.#entries[this.#index]!, data: next };
      this.#changed();
      return next;
    }
    if (action.type === "CLOSE_PANEL") {
      const { id } = action.payload;
      this.#closed.push({
        id,
        configs: _.omit(data.configById, Object.keys(next.configById)),
        placements: closePlacements(data, id),
      });
      if (this.#closed.length > HISTORY_LIMIT) {
        this.#closed.shift();
      }
    }
    this.#record(next, coalesceKey(action), now);
    return next;
  }

  public undo(data: LayoutData): LayoutData | undefined {
    this.sync(data);
    return this.goTo(data, this.#index - 1);
  }

  public redo(data: LayoutData): LayoutData | undefined {
    this.sync(data);
    return this.goTo(data, this.#index + 1);
  }

  /** Moves to step `index`, keeping the steps after it for redo. */
  public goTo(data: LayoutData, index: number): LayoutData | undefined {
    this.sync(data);
    const entry = this.#entries[index];
    if (entry == undefined || index === this.#index) {
      return undefined;
    }
    this.#index = index;
    // The next edit starts a new step instead of folding into the one just moved to.
    this.#lastKey = undefined;
    this.#changed();
    return entry.data;
  }

  /** Puts the most recently closed panel that is not in the layout back, with its config. */
  public reopenClosedPanel(data: LayoutData, now: number): LayoutData | undefined {
    this.sync(data);
    const present = new Set(getAllPanelIds(data));
    // Skip panels that are already back, e.g. through undo.
    let closed = this.#closed.pop();
    while (closed != undefined && present.has(closed.id)) {
      closed = this.#closed.pop();
    }
    if (closed == undefined) {
      return undefined;
    }
    const withConfigs = panelsReducer(data, {
      type: "SAVE_PANEL_CONFIGS",
      payload: {
        configs: Object.entries(closed.configs).map(([id, config]) => ({
          id,
          config,
          override: true,
        })),
      },
    });
    // An anchor that left the layout must not be used: without a target, "center" would add the
    // panel as a tab to whatever group is at the root.
    const placement = closed.placements.find(({ targetPanelId }) => present.has(targetPanelId));
    const next = panelsReducer(withConfigs, {
      type: "ADD_PANEL",
      payload: { id: closed.id, ...(placement ?? { position: "right" }) },
    });
    this.#record(next, undefined, now);
    return next;
  }

  #record(next: LayoutData, key: string | undefined, now: number): void {
    const coalesce =
      key != undefined && key === this.#lastKey && now - this.#lastTime < COALESCE_MS;
    if (coalesce) {
      this.#entries[this.#index] = { data: next, savedAt: Date.now() };
    } else {
      this.#push({ data: next, savedAt: Date.now() });
    }
    this.#lastKey = key;
    this.#lastTime = now;
    this.#changed();
  }

  /** Adds a step after the current one, dropping the redo steps. */
  #push(entry: HistoryEntry): void {
    this.#entries = [...this.#entries.slice(0, this.#index + 1), entry].slice(-(HISTORY_LIMIT + 1));
    this.#index = this.#entries.length - 1;
  }

  /** Data this history didn't produce (e.g. a revert) becomes a step of its own. */
  public sync(data: LayoutData): void {
    if (data !== this.#entries[this.#index]?.data) {
      this.#push({ data, savedAt: Date.now() });
      this.#lastKey = undefined;
      this.#changed();
    }
  }

  #changed(): void {
    this.#snapshot = { entries: [...this.#entries], index: this.#index };
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
