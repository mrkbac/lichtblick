// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import type * as Foxglove from "@foxglove/extension";
import { Immutable } from "immer";

import {
  SettingsIcon,
  SettingsTree,
  SettingsTreeAction,
  SettingsTreeField,
  SettingsTreeFieldMessagePath,
  SettingsTreeFieldValue,
  SettingsTreeNode,
  SettingsTreeNodeActionDivider,
} from "@lichtblick/suite";

// The editor renders trees from both Lichtblick and Foxglove extensions. These "Editor" types are
// the union of both settings tree APIs. They stay internal: `@lichtblick/suite` matches upstream.

export type EditorSettingsIcon = SettingsIcon | Foxglove.SettingsIcon;

type MessagePathFieldExtras = {
  /** Only suggest paths from these topics in autocomplete. */
  validTopics?: readonly string[];
  /** Same as `supportsMathModifiers`. */
  supportsMessagePathFunctions?: boolean;
  /** Allow time-series functions like @delta or @derivative. Defaults to false. */
  supportsTimeSeriesMessagePathFunctions?: boolean;
};

export type EditorSettingsTreeFieldMessagePath = SettingsTreeFieldMessagePath &
  MessagePathFieldExtras;

export type EditorSettingsTreeFieldValue =
  | Exclude<SettingsTreeFieldValue, { input: "messagepath" }>
  | EditorSettingsTreeFieldMessagePath
  | Extract<Foxglove.SettingsTreeFieldValue, { input: "multiline-string" }>;

export type EditorSettingsTreeField = EditorSettingsTreeFieldValue &
  Pick<SettingsTreeField, "disabled" | "help" | "label" | "readonly" | "error" | "tooltip"> & {
    /** Small text shown under the input. */
    caption?: string;
    /** Shown like `error` in warning colour; hidden while `error` is set. */
    warning?: string;
  };

export type EditorSettingsTreeNodeActionItem = Omit<Foxglove.SettingsTreeNodeActionItem, "icon"> & {
  icon?: EditorSettingsIcon;
};

export type EditorSettingsTreeNodeAction =
  | EditorSettingsTreeNodeActionItem
  | SettingsTreeNodeActionDivider;

export type EditorSettingsTreeNode = Omit<
  SettingsTreeNode,
  "actions" | "children" | "fields" | "icon"
> &
  Pick<Foxglove.SettingsTreeNode, "warning" | "color" | "help" | "drag" | "childrenReorderable"> & {
    actions?: EditorSettingsTreeNodeAction[];
    children?: EditorSettingsTreeNodes;
    fields?: Record<string, undefined | EditorSettingsTreeField>;
    icon?: EditorSettingsIcon;
  };

export type EditorSettingsTreeNodes = Record<string, undefined | EditorSettingsTreeNode>;

export type EditorSettingsTreeAction = SettingsTreeAction | Foxglove.SettingsTreeAction;

export type EditorSettingsTree = Omit<SettingsTree, "nodes" | "actionHandler"> & {
  actionHandler: (action: EditorSettingsTreeAction) => void;
  nodes: EditorSettingsTreeNodes;
};

/** Built-in panels only: a message path field that may also allow time-series functions. */
export type BuiltinSettingsTreeFieldMessagePath = SettingsTreeField & MessagePathFieldExtras;

/** Widens a built-in message path field to the extension API type without dropping its extra props. */
export function builtinMessagePathField<
  F extends BuiltinSettingsTreeFieldMessagePath & { input: "messagepath" },
>(field: F): F {
  return field;
}

export type NodeActionsMenuProps = {
  actions: readonly EditorSettingsTreeNodeAction[];
  onSelectAction: (actionId: string) => void;
};

/** Set on a child of a `childrenReorderable` parent. */
export type ChildReorderContext = {
  /** Path of the parent node. */
  parentPath: readonly string[];
  /** Parents sharing a group accept children dragged from each other. */
  group: string | undefined;
  /** Keys of the parent's reorderable children, in order (unfiltered). */
  siblingKeys: readonly string[];
  /** False while a filter hides some children, so drags never act on a partial list. */
  dragEnabled: boolean;
};

export type NodeEditorProps = {
  actionHandler: (action: EditorSettingsTreeAction) => void;
  defaultOpen?: boolean;
  filter?: string;
  focusedPath?: readonly string[];
  path: readonly string[];
  settings?: Immutable<EditorSettingsTreeNode>;
  reorderContext?: ChildReorderContext;
};

export type SelectVisibilityFilterValue = "all" | "visible" | "invisible";

export type FieldEditorProps = {
  actionHandler: (action: EditorSettingsTreeAction) => void;
  field: Immutable<EditorSettingsTreeField>;
  path: readonly string[];
};

export type SettingsTreeEditorProps = {
  variant: "panel" | "log";
  settings: Immutable<SettingsTree>;
};

export type DragItem = {
  path: readonly string[];
};

export type NodeEditorState = {
  editing: boolean;
  focusedPath: undefined | readonly string[];
  open: boolean;
  textFilter: string;
  visibilityFilter: SelectVisibilityFilterValue;
};
