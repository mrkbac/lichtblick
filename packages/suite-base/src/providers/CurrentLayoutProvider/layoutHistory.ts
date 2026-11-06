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

/** Undo steps kept per layout. */
export const HISTORY_LIMIT = 100;
/** Edits of the same kind closer together than this become one undo step (typing, slider drags). */
export const COALESCE_MS = 500;

type ClosedPanel = {
  id: string;
  /** Configs of the panel and of anything that left the layout with it. */
  configs: Record<string, PanelConfig>;
  position: LayoutDropPosition;
  targetPanelId?: string;
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
 * Where to put a closed panel back: as a tab next to its former tab mates, else beside its former
 * neighbour in the split, else along the right edge.
 */
export function reopenPlacement(
  node: LayoutNode | undefined,
  panelId: string,
): Pick<ClosedPanel, "position" | "targetPanelId"> {
  if (node == undefined) {
    return { position: "right" };
  }
  if (isLayoutGroup(node)) {
    const mate = node.panels.find((id) => id !== panelId);
    return mate != undefined ? { position: "center", targetPanelId: mate } : { position: "right" };
  }
  const index = node.children.findIndex((child) => getPanelIds(child).includes(panelId));
  const child = node.children[index];
  if (child == undefined) {
    return { position: "right" };
  }
  if (!isLayoutGroup(child) || child.panels.length > 1) {
    return reopenPlacement(child, panelId);
  }
  const after = node.children[index + 1];
  const neighbour = after ?? node.children[index - 1];
  const targetPanelId = neighbour ? getPanelIds(neighbour)[0] : undefined;
  if (targetPanelId == undefined) {
    return { position: "right" };
  }
  const row = node.direction === "row";
  // We were before `after`, or after the previous child.
  const position = after ? (row ? "left" : "top") : row ? "right" : "bottom";
  return { position, targetPanelId };
}

/**
 * Undo/redo history of one layout's data. Layout data is immutable, so steps are snapshots that
 * share structure. Any data it did not produce itself (another layout loaded, a revert) resets it.
 */
export class LayoutHistory {
  #past: LayoutData[] = [];
  #future: LayoutData[] = [];
  #closed: ClosedPanel[] = [];
  #current: LayoutData | undefined;
  #lastKey: string | undefined;
  #lastTime = -Infinity;

  public canUndo(): boolean {
    return this.#past.length > 0;
  }

  public canRedo(): boolean {
    return this.#future.length > 0;
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
    this.#sync(data);
    if (fillsDefaults(data, action)) {
      // Fold into the current state: no undo step to get stuck on (the panel would save its
      // defaults again right away), and redo stays intact when undo remounts a panel.
      this.#current = next;
      return next;
    }
    if (action.type === "CLOSE_PANEL") {
      const { id } = action.payload;
      this.#closed.push({
        id,
        configs: _.omit(data.configById, Object.keys(next.configById)),
        ...reopenPlacement(data.layout, id),
      });
      if (this.#closed.length > HISTORY_LIMIT) {
        this.#closed.shift();
      }
    }
    this.#record(data, next, coalesceKey(action), now);
    return next;
  }

  public undo(data: LayoutData): LayoutData | undefined {
    this.#sync(data);
    const prev = this.#past.pop();
    if (prev == undefined) {
      return undefined;
    }
    this.#future.push(data);
    return this.#moveTo(prev);
  }

  public redo(data: LayoutData): LayoutData | undefined {
    this.#sync(data);
    const next = this.#future.pop();
    if (next == undefined) {
      return undefined;
    }
    this.#past.push(data);
    return this.#moveTo(next);
  }

  /** Puts the most recently closed panel that is not in the layout back, with its config. */
  public reopenClosedPanel(data: LayoutData, now: number): LayoutData | undefined {
    this.#sync(data);
    const present = new Set(getPanelIds(data.layout));
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
    const { id, position, targetPanelId } = closed;
    const next = panelsReducer(withConfigs, {
      type: "ADD_PANEL",
      payload: {
        id,
        position,
        targetPanelId:
          targetPanelId != undefined && present.has(targetPanelId) ? targetPanelId : undefined,
      },
    });
    this.#record(data, next, undefined, now);
    return next;
  }

  #record(prev: LayoutData, next: LayoutData, key: string | undefined, now: number): void {
    const coalesce =
      key != undefined && key === this.#lastKey && now - this.#lastTime < COALESCE_MS;
    if (!coalesce) {
      this.#past.push(prev);
      if (this.#past.length > HISTORY_LIMIT) {
        this.#past.shift();
      }
    }
    this.#future = [];
    this.#lastKey = key;
    this.#lastTime = now;
    this.#current = next;
  }

  #moveTo(data: LayoutData): LayoutData {
    // The next edit starts a new step instead of folding into the one just undone.
    this.#lastKey = undefined;
    this.#current = data;
    return data;
  }

  #sync(data: LayoutData): void {
    if (data !== this.#current) {
      this.#past = [];
      this.#future = [];
      this.#closed = [];
      this.#lastKey = undefined;
      this.#current = data;
    }
  }
}
