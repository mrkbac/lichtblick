// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import { Immutable } from "@lichtblick/suite";

import { EditorSettingsTreeNode, EditorSettingsTreeNodes } from "./types";

/**
 * Filters and sorts roots to prepare them for rendering.
 */
export function prepareSettingsNodes(
  roots: Immutable<EditorSettingsTreeNodes>,
): Immutable<Array<[string, EditorSettingsTreeNode]>> {
  // Use sortBy here for stable sorting.
  return _.sortBy(
    Object.entries(roots).filter(
      (entry): entry is [string, EditorSettingsTreeNode] => entry[1] != undefined,
    ),
    (entry) => entry[1].order,
  );
}

/**
 * Recursively filter out nodes that don't match the given filter.
 */
export function filterTreeNodes(
  nodes: Immutable<EditorSettingsTreeNodes>,
  filter: string,
): Immutable<EditorSettingsTreeNodes> {
  const result: Record<string, Immutable<EditorSettingsTreeNode>> = {};
  Object.entries(nodes).forEach(([key, node]) => {
    if (node == undefined) {
      return;
    }

    // Include node in results if any children match the filter.
    const filtered = filterTreeNodes(node.children ?? {}, filter);
    if (Object.values(filtered).length > 0) {
      result[key] = { ...node, children: filtered };
    }

    // Match on label or key in tree.
    const stringToMatch = (node.label ?? key).toLocaleLowerCase();
    if (stringToMatch.includes(filter.toLocaleLowerCase())) {
      result[key] = node;
    }
    return;
  });

  return result;
}
