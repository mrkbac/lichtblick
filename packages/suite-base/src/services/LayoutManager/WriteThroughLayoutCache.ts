// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { LayoutID } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { ILayoutStorage, Layout } from "@lichtblick/suite-base/services/ILayoutStorage";

/**
 * A view of ILayoutCache which only calls the underlying list() once per namespace, and implements
 * all operations on the cached data in memory as well as writing through to the underlying storage.
 *
 * For this to be useful, we must assume nothing else is accessing the same underlying storage.
 */
export default class WriteThroughLayoutCache implements ILayoutStorage {
  #cacheByNamespace = new Map<string, Promise<Map<string, Layout>>>();

  public constructor(private storage: ILayoutStorage) {}

  async #getOrCreateCache(namespace: string): Promise<Map<string, Layout>> {
    let cache = this.#cacheByNamespace.get(namespace);
    if (!cache) {
      cache = this.storage
        .list(namespace)
        .then((layouts) => new Map(layouts.map((layout) => [layout.id, layout])));
      const pending = cache;
      // Don't keep a failed load: the next access retries instead of failing until reload
      pending.catch(() => {
        if (this.#cacheByNamespace.get(namespace) === pending) {
          this.#cacheByNamespace.delete(namespace);
        }
      });
      this.#cacheByNamespace.set(namespace, cache);
    }
    return await cache;
  }

  public async importLayouts(params: {
    fromNamespace: string;
    toNamespace: string;
  }): Promise<void> {
    await this.storage.importLayouts(params);
  }

  public async migrateUnnamespacedLayouts(namespace: string): Promise<void> {
    await this.storage.migrateUnnamespacedLayouts?.(namespace);
  }

  public async list(namespace: string): Promise<readonly Layout[]> {
    return Array.from((await this.#getOrCreateCache(namespace)).values());
  }

  public async get(namespace: string, id: LayoutID): Promise<Layout | undefined> {
    return (await this.#getOrCreateCache(namespace)).get(id);
  }

  public async put(namespace: string, layout: Layout): Promise<Layout> {
    const result = await this.storage.put(namespace, layout);
    (await this.#getOrCreateCache(namespace)).set(result.id, result);
    return result;
  }

  public async delete(namespace: string, id: LayoutID): Promise<void> {
    await this.storage.delete(namespace, id);
    (await this.#getOrCreateCache(namespace)).delete(id);
  }
}
