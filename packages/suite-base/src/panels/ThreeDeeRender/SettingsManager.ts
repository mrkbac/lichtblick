// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EventEmitter from "eventemitter3";
import { produce } from "immer";

import { SettingsTreeAction } from "@lichtblick/suite";
import type {
  DocumentedNode,
  DocumentedNodes,
} from "@lichtblick/suite-base/panels/shared/documentedSettings";

import { LayerErrors, Path } from "./LayerErrors";

export type ActionHandler = (action: SettingsTreeAction) => void;

/** Every field in the 3D settings tree needs `help`: the sidebar shows it and the guide lists it. */
export type SettingsTreeNodeWithActionHandler = DocumentedNode & { handler?: ActionHandler };

export type SettingsTreeEntry = { path: Path; node: SettingsTreeNodeWithActionHandler };

export type SettingsManagerEvents = {
  update: () => void;
};

type NodeValidator = (entry: SettingsTreeEntry, errorState: LayerErrors) => void;

export class SettingsManager extends EventEmitter<SettingsManagerEvents> {
  public errors = new LayerErrors();

  #nodesByKey = new Map<string, SettingsTreeEntry[]>();
  #root: SettingsTreeNodeWithActionHandler = { children: {} };

  #globalSettingsEntryValidators: NodeValidator[] = [];

  /** Adjusts every entry an extension (`key`) sets, e.g. to add panel-wide fields to topic nodes */
  public decorateEntry: (key: string, entry: SettingsTreeEntry) => SettingsTreeEntry = (
    _key,
    entry,
  ) => entry;

  public constructor(baseTree: DocumentedNodes) {
    super();

    this.#root = { children: baseTree };
    this.errors.on("update", this.handleErrorUpdate);
    this.errors.on("remove", this.handleErrorUpdate);
    this.errors.on("clear", this.handleErrorUpdate);
  }

  public setNodesForKey(key: string, undecoratedNodes: SettingsTreeEntry[]): void {
    const nodes = undecoratedNodes.map((entry) => this.decorateEntry(key, entry));
    nodes.forEach((entry) => {
      this.#globalSettingsEntryValidators.forEach((validator) => {
        validator(entry, this.errors);
      });
    });

    this.#root = produce(this.#root, (draft) => {
      // Delete all previous nodes for this key
      const prevNodes = this.#nodesByKey.get(key);
      if (prevNodes) {
        for (const { path } of prevNodes) {
          removeNodeAtPath(draft, path);
        }
      }
      // Add the new nodes
      for (const { path, node } of nodes) {
        node.error ??= this.errors.errors.errorAtPath(path);
        node.label ??= path[path.length - 1];
        node.defaultExpansionState ??= "collapsed";
        addNodeAtPath(draft, path, node);
      }
    });

    // Update the map of nodes by key
    this.#nodesByKey.set(key, nodes);

    this.emit("update");
  }

  public setLabel(path: Path, label: string): void {
    this.#root = produce(this.#root, (draft) => {
      setLabelAtPath(draft, path, label);
    });

    this.emit("update");
  }

  public clearChildren(path: Path): void {
    this.#root = produce(this.#root, (draft) => {
      clearChildren(draft, path);
    });

    this.emit("update");
  }

  public tree(): DocumentedNodes {
    return this.#root.children ?? {};
  }

  public handleAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;

    // Walk the settings tree down to the end of the path, firing any action
    // handlers along the way
    let curNode = this.#root;
    curNode.handler?.(action);
    for (const segment of path) {
      const nextNode: SettingsTreeNodeWithActionHandler | undefined = curNode.children?.[segment];
      if (!nextNode) {
        return;
      }
      nextNode.handler?.(action);
      curNode = nextNode;
    }
  };

  /** Add Validator function that can run over nodes `set` on the tree and update error state accordingly */
  public addNodeValidator = (nodeValidator: NodeValidator): void => {
    this.#globalSettingsEntryValidators.push(nodeValidator);
  };

  public removeNodeValidator = (nodeValidator: NodeValidator): void => {
    this.#globalSettingsEntryValidators = this.#globalSettingsEntryValidators.filter(
      (v) => v !== nodeValidator,
    );
  };

  public handleErrorUpdate = (path: Path): void => {
    this.#root = produce(this.#root, (draft) => {
      if (path.length === 0) {
        return { ...draft };
      }

      let curNode = draft;
      for (const segment of path) {
        const nextNode = curNode.children?.[segment];
        if (!nextNode) {
          curNode.children = { ...curNode.children };
          return draft;
        }
        curNode = nextNode;
      }

      curNode.error = this.errors.errors.errorAtPath(path);
      return draft;
    });

    this.emit("update");
  };
}

function removeNodeAtPath(root: DocumentedNode, path: Path): boolean {
  const segment = path[0];
  const children = root.children;
  const nextNode = segment == undefined ? undefined : children?.[segment];
  if (segment == undefined || !children || !nextNode) {
    return false;
  }

  if (path.length === 1) {
    children[segment] = undefined;
    return true;
  }

  return removeNodeAtPath(nextNode, path.slice(1));
}

function clearChildren(root: DocumentedNode, path: Path): void {
  const segment = path[0];
  const nextNode = segment == undefined ? undefined : root.children?.[segment];
  if (!nextNode) {
    return;
  }

  if (path.length === 1) {
    nextNode.children = undefined;
    return;
  }

  clearChildren(nextNode, path.slice(1));
}

function addNodeAtPath(root: DocumentedNode, path: Path, node: DocumentedNode): void {
  const lastSegment = path.at(-1);
  if (lastSegment == undefined) {
    throw new Error(`Empty path for settings node "${node.label}"`);
  }

  // Recursively walk/build the settings tree down to the end of the path except
  // for the last segment, which is the node to add
  let curNode = root;
  for (const segment of path.slice(0, -1)) {
    curNode.children ??= {};
    curNode = curNode.children[segment] ??= {};
  }

  // Assign the node to the last segment of the path
  curNode.children ??= {};
  curNode.children[lastSegment] = node;
}

function setLabelAtPath(root: DocumentedNode, path: Path, label: string): void {
  if (path.length === 0) {
    throw new Error(`Empty path for settings label "${label}"`);
  }

  // Recursively walk/build the settings tree down to the end of the path
  let curNode = root;
  for (const segment of path) {
    curNode.children ??= {};
    curNode = curNode.children[segment] ??= {};
  }

  curNode.label = label;
}
