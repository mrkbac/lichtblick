// SPDX-License-Identifier: MPL-2.0

import type { SettingsTree, SettingsTreeField, SettingsTreeNode } from "@lichtblick/suite";

/**
 * A built-in panel's settings field. `help` is required: the settings sidebar shows it on hover
 * and the panel guide lists it, so a new setting can't ship undocumented.
 */
export type DocumentedField = SettingsTreeField & { help: string };

export type DocumentedFields = Record<string, DocumentedField | undefined>;

/** A settings node whose fields (and children's fields) are all documented. */
export type DocumentedNode = Omit<SettingsTreeNode, "fields" | "children"> & {
  fields?: DocumentedFields;
  children?: DocumentedNodes;
};

export type DocumentedNodes = Record<string, DocumentedNode | undefined>;

/** What built-in panels pass to `usePanelSettingsTreeUpdate`. */
export type DocumentedSettingsTree = Omit<SettingsTree, "nodes"> & { nodes: DocumentedNodes };
