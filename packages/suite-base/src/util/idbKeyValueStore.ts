// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { openDB } from "idb";

export type KeyValueStore = {
  get: <T>(key: IDBValidKey) => Promise<T | undefined>;
  set: (key: IDBValidKey, value: unknown) => Promise<void>;
  setMany: (entries: [IDBValidKey, unknown][]) => Promise<void>;
};

/**
 * A key-value object store, one per database. Opens version 1 with an out-of-line-key store,
 * the same layout idb-keyval's createStore() made, so databases written by it stay readable.
 */
export function createKeyValueStore(dbName: string, storeName: string): KeyValueStore {
  let db: ReturnType<typeof openDB> | undefined;
  const open = async () =>
    await (db ??= openDB(dbName, 1, {
      upgrade(database) {
        database.createObjectStore(storeName);
      },
    }));
  return {
    get: async <T>(key: IDBValidKey) => (await (await open()).get(storeName, key)) as T | undefined,
    set: async (key, value) => {
      await (await open()).put(storeName, value, key);
    },
    setMany: async (entries) => {
      const tx = (await open()).transaction(storeName, "readwrite");
      await Promise.all([
        ...entries.map(async ([key, value]) => await tx.store.put(value, key)),
        tx.done,
      ]);
    },
  };
}
