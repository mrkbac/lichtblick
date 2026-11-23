// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EventEmitter from "eventemitter3";

import Logger from "@lichtblick/log";

export type Path = ReadonlyArray<string>;

const TOPIC_PATH: [string, string] = ["topics", ""];

export class NodeError {
  public path: Path;
  public errorsById?: Map<string, string>;
  public children?: Map<string, NodeError>;

  public constructor(path: Path) {
    this.path = path;
  }

  public errorMessage(): string | undefined {
    if (this.errorsById && this.errorsById.size > 0) {
      const errorMessages = Array.from(this.errorsById.values());
      return errorMessages.join(`\n`);
    } else {
      return undefined;
    }
  }

  public errorAtPath(path: Path): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let node: NodeError | undefined = this;
    for (const segment of path) {
      node = node.children?.get(segment);
      if (!node) {
        return undefined;
      }
    }
    return node.errorMessage();
  }

  public clone(): NodeError {
    const clone = new NodeError(this.path);
    clone.errorsById = this.errorsById;
    clone.children = this.children;
    return clone;
  }
}

export type LayerErrorEvents = {
  add: (path: Path, errorId: string) => void;
  update: (path: Path, errorId: string, errorMessage: string) => void;
  remove: (path: Path, errorId: string) => void;
  clear: (path: Path) => void;
};

const log = Logger.getLogger(__filename);

export class LayerErrors extends EventEmitter<LayerErrorEvents> {
  public errors = new NodeError([]);

  public add(path: Path, errorId: string, errorMessage: string): void {
    // Get or create the node for the given path
    let node = this.errors;
    for (const segment of path) {
      node.children ??= new Map();
      let child = node.children.get(segment);
      if (!child) {
        child = new NodeError([...node.path, segment]);
        node.children.set(segment, child);
      }
      node = child;
    }

    // Create the error map if it does not already exist
    node.errorsById ??= new Map();

    // Log the first error message per path+id.
    const prevErrorMessage = node.errorsById.get(errorId);
    if (prevErrorMessage == undefined) {
      this.emit("add", path, errorId);
      log.warn(`[${path.join(" > ")}] ${errorMessage}`);
    }

    // Add or update the error
    if (errorMessage !== prevErrorMessage) {
      node.errorsById.set(errorId, errorMessage);
      this.emit("update", path, errorId, errorMessage);
    }
  }

  public addToTopic(topicId: string, errorId: string, errorMessage: string): void {
    TOPIC_PATH[1] = topicId;
    this.add(TOPIC_PATH, errorId, errorMessage);
  }

  public getError(path: Path, errorId: string): string | undefined {
    return this.#getNode(path)?.errorsById?.get(errorId);
  }

  public hasError(path: Path, errorId: string): boolean {
    return this.getError(path, errorId) != undefined;
  }

  public remove(path: Path, errorId: string): void {
    const node = this.#getNode(path);
    if (node?.errorsById?.has(errorId) === true) {
      node.errorsById.delete(errorId);
      this.emit("remove", path, errorId);
    }
  }

  public removeFromTopic(topicId: string, errorId: string): void {
    TOPIC_PATH[1] = topicId;
    this.remove(TOPIC_PATH, errorId);
  }

  /**
   * If value is falsy then add error to path, otherwise remove error from settings path
   * @param value - value to check, if false, add error, if true, remove error
   * @param path  - path to add/remove error
   * @param errorId - id unique to error
   * @param errorMessage - error message
   */
  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  public errorIfFalse(value: boolean, path: Path, errorId: string, errorMessage: string): void {
    if (!value) {
      this.add(path, errorId, errorMessage);
    } else {
      this.remove(path, errorId);
    }
  }

  public clearPath(path: Path): void {
    const node = this.#getNode(path);
    if (!node) {
      return;
    }
    let cleared = false;
    if (node.children && node.children.size > 0) {
      node.children.clear();
      cleared = true;
    }
    if (node.errorsById && node.errorsById.size > 0) {
      node.errorsById.clear();
      cleared = true;
    }
    if (cleared) {
      this.emit("clear", path);
    }
  }

  public clearTopic(topicId: string): void {
    TOPIC_PATH[1] = topicId;
    this.clearPath(TOPIC_PATH);
  }

  public clear(): void {
    this.clearPath([]);
  }

  #getNode(path: Path): NodeError | undefined {
    let node: NodeError | undefined = this.errors;
    for (const segment of path) {
      node = node.children?.get(segment);
      if (!node) {
        return undefined;
      }
    }
    return node;
  }
}

/**
 * Report errors that are still active 3 s after they were raised. Most layer errors on a good
 * recording are transient (a transform, camera info or frame that arrives a moment after the first
 * message) and resolve on their own, so they stay in the settings tree but never reach the log.
 * @param now - the current playback time
 * @returns unsubscribe
 */
export function reportPersistentErrors(
  errors: LayerErrors,
  report: (path: Path, errorId: string, errorMessage: string, raisedAt: bigint) => void,
  now: () => bigint,
): () => void {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const onAdd = (path: Path, errorId: string) => {
    const pathCopy = [...path]; // callers reuse path arrays
    const raisedAt = now(); // reported as of when it was raised, not the grace period later
    const key = `${pathCopy.join("\0")}\0${errorId}`;
    clearTimeout(pending.get(key));
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        const message = errors.getError(pathCopy, errorId);
        if (message != undefined) {
          report(pathCopy, errorId, message, raisedAt);
        }
      }, 3000),
    );
  };
  errors.on("add", onAdd);
  return () => {
    errors.off("add", onAdd);
    for (const timeout of pending.values()) {
      clearTimeout(timeout);
    }
  };
}
