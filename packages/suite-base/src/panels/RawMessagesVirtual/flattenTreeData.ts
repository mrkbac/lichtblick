// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PATH_NAME_AGGREGATOR } from "@lichtblick/suite-base/panels/RawMessagesCommon/constants";
import {
  DiffStatus,
  diffLabels,
  TreeNode,
} from "@lichtblick/suite-base/panels/RawMessagesCommon/types";
import { typedArrayToArray } from "@lichtblick/suite-base/panels/RawMessagesCommon/utils";

const DIFF_STATUS_BY_LABEL: Record<string, DiffStatus> = {
  [diffLabels.ADDED.labelText]: "added",
  [diffLabels.CHANGED.labelText]: "changed",
  [diffLabels.DELETED.labelText]: "deleted",
};

export type FlattenOptions = {
  /** Treat `data` as the output of getDiff: unwrap diff labels into per-node statuses. */
  diff?: boolean;
  /** Only emit nodes for which this returns true (e.g. search matches and their ancestors). */
  include?: (key: string) => boolean;
  /** Below these nodes, `include` no longer applies (e.g. the contents of a search match). */
  includeSubtreeOf?: Set<string>;
  cache?: WeakMap<object, unknown[]>;
  parentPath?: string;
  depth?: number;
  keyPath?: (string | number)[];
  diffStatus?: DiffStatus;
};

function entriesOf(
  value: unknown,
  cache: WeakMap<object, unknown[]>,
): [string | number, unknown][] {
  if (value == undefined || typeof value !== "object") {
    return [];
  }
  // Convert typed arrays to regular arrays so their elements can be iterated.
  const iterable = typedArrayToArray(value, cache);
  return Array.isArray(iterable)
    ? iterable.map((item, index) => [index, item] as [number, unknown])
    : Object.entries(iterable as Record<string, unknown>);
}

/**
 * Unwrap a diff node like `{ STUDIO_DIFF___CHANGED: "1 -> 2" }` into its value and status. Nodes
 * that also carry a `STUDIO_DIFF___ID` entry keep it; it is shown in the summary, not as a row.
 */
export function unwrapDiffValue(value: unknown): { value: unknown; status?: DiffStatus } {
  if (value == undefined || typeof value !== "object" || Array.isArray(value)) {
    return { value };
  }
  const keys = Object.keys(value).filter((key) => key !== diffLabels.ID.labelText);
  const status = keys.length === 1 ? DIFF_STATUS_BY_LABEL[keys[0]!] : undefined;
  if (status == undefined || keys.length !== Object.keys(value).length) {
    return { value };
  }
  return { value: (value as Record<string, unknown>)[keys[0]!], status };
}

function isExpandable(value: unknown, { diff }: { diff: boolean }): boolean {
  if (value == undefined || typeof value !== "object") {
    return false;
  }
  if (ArrayBuffer.isView(value)) {
    return !(value instanceof DataView) && (value as unknown as ArrayLike<unknown>).length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  const keys = Object.keys(value);
  return diff ? keys.some((key) => key !== diffLabels.ID.labelText) : keys.length > 0;
}

/** Flatten the visible part of a message tree into rows for the virtualized list. */
export function flattenTreeData(
  data: unknown,
  isExpanded: (key: string, value: unknown) => boolean,
  options: FlattenOptions = {},
): TreeNode[] {
  const {
    diff = false,
    include,
    includeSubtreeOf,
    cache = new WeakMap<object, unknown[]>(),
    parentPath = "",
    depth = 0,
    keyPath = [],
    diffStatus,
  } = options;

  const nodes: TreeNode[] = [];
  for (const [key, rawValue] of entriesOf(data, cache)) {
    if (diff && key === diffLabels.ID.labelText) {
      continue;
    }
    const nodePath = parentPath ? `${key}${PATH_NAME_AGGREGATOR}${parentPath}` : String(key);
    if (include && !include(nodePath)) {
      continue;
    }
    const unwrapped = diff ? unwrapDiffValue(rawValue) : { value: rawValue };
    // Children of added/deleted nodes inherit the status; "changed" only applies to the leaf.
    const status = unwrapped.status ?? (diffStatus === "changed" ? undefined : diffStatus);
    const currentKeyPath = [key, ...keyPath];
    const node: TreeNode = {
      key: nodePath,
      label: String(key),
      value: unwrapped.value,
      depth,
      isExpandable: isExpandable(unwrapped.value, { diff }),
      keyPath: currentKeyPath,
      parentPath,
      ...(status ? { diffStatus: status } : undefined),
    };
    nodes.push(node);

    if (node.isExpandable && isExpanded(nodePath, node.value)) {
      for (const child of flattenTreeData(unwrapped.value, isExpanded, {
        diff,
        include: includeSubtreeOf?.has(nodePath) === true ? undefined : include,
        includeSubtreeOf,
        cache,
        parentPath: nodePath,
        depth: depth + 1,
        keyPath: currentKeyPath,
        diffStatus: status,
      })) {
        nodes.push(child);
      }
    }
  }
  return nodes;
}

/**
 * Search the whole tree (not only expanded nodes) for keys or primitive values containing `query`.
 * Returns the keys of matching nodes and of all their ancestors, so they can be shown expanded.
 */
export function searchTreeData(
  data: unknown,
  query: string,
  {
    diff = false,
    cache = new WeakMap<object, unknown[]>(),
  }: Pick<FlattenOptions, "diff" | "cache"> = {},
): { matches: Set<string>; visible: Set<string>; ancestors: Set<string> } {
  const needle = query.toLowerCase();
  const matches = new Set<string>();
  const visible = new Set<string>();
  const ancestors = new Set<string>();

  // Returns true if this subtree contains a match.
  const visit = (value: unknown, parentPath: string): boolean => {
    let found = false;
    for (const [key, rawValue] of entriesOf(value, cache)) {
      if (diff && key === diffLabels.ID.labelText) {
        continue;
      }
      const nodePath = parentPath ? `${key}${PATH_NAME_AGGREGATOR}${parentPath}` : String(key);
      const child = diff ? unwrapDiffValue(rawValue).value : rawValue;
      const isLeaf = child == undefined || typeof child !== "object";
      const selfMatch =
        String(key).toLowerCase().includes(needle) ||
        (isLeaf &&
          String(child as string | number | boolean | bigint | undefined)
            .toLowerCase()
            .includes(needle));
      // ponytail: typed arrays (point clouds, images) are skipped; searching millions of numbers
      // per message is slow and rarely useful. Search their parent key instead.
      const childMatch = !isLeaf && !ArrayBuffer.isView(child) && visit(child, nodePath);
      if (selfMatch) {
        matches.add(nodePath);
      }
      if (childMatch) {
        ancestors.add(nodePath);
      }
      if (selfMatch || childMatch) {
        visible.add(nodePath);
        found = true;
      }
    }
    return found;
  };

  visit(data, "");
  return { matches, visible, ancestors };
}
