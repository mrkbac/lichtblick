// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as Comlink from "@foxglove/comlink";

import Log from "@lichtblick/log";

import type { RuntimeWorkerApi } from "./runtimeWorker";

const log = Log.getLogger(__filename);

export type RuntimeWorker = {
  readonly rpc: Comlink.Remote<RuntimeWorkerApi>;
};

type Entry = RuntimeWorker & {
  port: MessagePort;
  onError: (message: string) => void;
};

const ignoreError = () => {};

/**
 * Owns every user script runtime worker. Workers are handed out with acquire(), go back to the
 * idle list with release(), and dispose() closes all of them, idle or not. Nothing else creates
 * runtime workers, so closing the pool is enough to free them.
 */
export class RuntimeWorkerPool {
  readonly #create: () => SharedWorker;
  readonly #all = new Set<Entry>();
  #idle: Entry[] = [];
  #disposed = false;

  public constructor(create: () => SharedWorker) {
    this.#create = create;
  }

  /** Number of workers that are alive (idle or in use). */
  public size(): number {
    return this.#all.size;
  }

  /** Get a worker; `onError` receives its runtime errors until it is released. */
  public acquire(onError: (message: string) => void): RuntimeWorker {
    if (this.#disposed) {
      throw new Error("RuntimeWorkerPool was disposed");
    }
    const entry = this.#idle.pop() ?? this.#spawn();
    entry.onError = onError;
    return entry;
  }

  public release(worker: RuntimeWorker): void {
    const entry = worker as Entry;
    if (!this.#all.has(entry)) {
      return;
    }
    entry.onError = ignoreError;
    this.#idle.push(entry);
  }

  /** Close every worker. The pool can't be used afterwards. */
  public dispose(): void {
    this.#disposed = true;
    for (const entry of this.#all) {
      entry.rpc.close().catch(ignoreError);
      entry.port.close();
    }
    this.#all.clear();
    this.#idle = [];
  }

  #spawn(): Entry {
    const worker = this.#create();
    const port: MessagePort = worker.port;
    const entry: Entry = { port, rpc: Comlink.wrap<RuntimeWorkerApi>(port), onError: ignoreError };
    const report = (message: string) => {
      log.error(message);
      entry.onError(message);
    };
    worker.onerror = (event) => {
      report(event.message);
    };
    port.onmessageerror = (event) => {
      report(String(event.data));
    };
    port.start();
    void entry.rpc.onError(Comlink.proxy(report));
    this.#all.add(entry);
    return entry;
  }
}
