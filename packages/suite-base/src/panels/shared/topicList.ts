// SPDX-License-Identifier: MPL-2.0

import i18next from "i18next";

import { SettingsTreeAction, SettingsTreeChildren, SettingsTreeNode } from "@lichtblick/suite";

/**
 * The one way a panel lets users choose which of several topics it shows.
 *
 * - The panel lists every topic it can read (auto-detected by schema) as a child of one "Topics"
 *   node, keyed by topic name and labelled with it. No "add topic" dropdowns.
 * - Each child's eye (`visible`) turns the topic on or off. Per-topic settings are fields on the
 *   child, never a check on the topic's name.
 * - The node has the visibility filter and "Show all" / "Hide all" actions; handle them with
 *   {@link showHideAllValue}.
 * - A topic the config still references but the source doesn't have stays listed, with an error.
 */
export function topicListNode<T extends SettingsTreeNode>(
  node: T & { children: SettingsTreeChildren },
): T {
  return {
    enableVisibilityFilter: true,
    defaultExpansionState: "expanded",
    ...node,
    actions: [
      { id: SHOW_ALL_ACTION, type: "action", label: i18next.t("settingsEditor:showAll") },
      { id: HIDE_ALL_ACTION, type: "action", label: i18next.t("settingsEditor:hideAll") },
      ...(node.actions ?? []),
    ],
  };
}

export const SHOW_ALL_ACTION = "show-all";
export const HIDE_ALL_ACTION = "hide-all";

/** The visibility a "Show all" / "Hide all" action sets, or undefined for any other action. */
export function showHideAllValue(action: SettingsTreeAction): boolean | undefined {
  if (action.action !== "perform-node-action") {
    return undefined;
  }
  switch (action.payload.id) {
    case SHOW_ALL_ACTION:
      return true;
    case HIDE_ALL_ACTION:
      return false;
    default:
      return undefined;
  }
}
