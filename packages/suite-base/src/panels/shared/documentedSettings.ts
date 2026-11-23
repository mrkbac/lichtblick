// SPDX-License-Identifier: MPL-2.0

import type {
  SettingsTree,
  SettingsTreeField,
  SettingsTreeNode,
  SettingsTreeNodeAction,
} from "@lichtblick/suite";

import type { TopicListSettings } from "./topicList";

/**
 * A built-in panel's settings field. `help` is required: the settings sidebar shows it on hover
 * and the panel guide lists it, so a new setting can't ship undocumented.
 */
export type DocumentedField = SettingsTreeField & { help: string };

export type DocumentedFields = Record<string, DocumentedField | undefined>;

/** An action; a `tooltip` (shown on hover, as for extensions) also lists it in the panel guide. */
export type DocumentedAction = SettingsTreeNodeAction & { tooltip?: string };

/** A settings node whose fields (and children's fields) are all documented. */
export type DocumentedNode = Omit<SettingsTreeNode, "fields" | "children" | "actions"> &
  TopicListSettings & {
    /** Shown on hover of the node's label and in the panel guide. */
    help?: string;
    actions?: DocumentedAction[];
    fields?: DocumentedFields;
    children?: DocumentedNodes;
  };

export type DocumentedNodes = Record<string, DocumentedNode | undefined>;

/** What built-in panels pass to `usePanelSettingsTreeUpdate`. */
export type DocumentedSettingsTree = Omit<SettingsTree, "nodes"> & { nodes: DocumentedNodes };
