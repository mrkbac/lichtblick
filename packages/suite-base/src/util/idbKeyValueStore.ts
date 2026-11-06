// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { IDBPDatabase, openDB } from "idb";

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
  let db: Promise<IDBPDatabase> | undefined;
  const open = async (): Promise<IDBPDatabase> => {
    if (db) {
      return await db;
    }
    const opening = openDB(dbName, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName);
        }
      },
      // Let a newer tab upgrade the database, and reopen on the next call.
      blocking() {
        void opening.then((database) => {
          database.close();
        });
        forget();
      },
      // The browser closed the connection; reopen on the next call.
      terminated: forget,
    });
    function forget() {
      // A callback from an old connection must not drop a newer one.
      if (db === opening) {
        db = undefined;
      }
    }
    db = opening;
    // A failed open is retried on the next call instead of failing forever.
    opening.catch(forget);
    return await opening;
  };
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
