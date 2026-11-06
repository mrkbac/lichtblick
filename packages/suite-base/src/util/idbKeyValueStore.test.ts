// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { createKeyValueStore } from "./idbKeyValueStore";

describe("createKeyValueStore", () => {
  it("round-trips values and setMany", async () => {
    const store = createKeyValueStore("kv-roundtrip", "items");
    expect(await store.get("missing")).toBeUndefined();
    await store.set("a", { n: 1 });
    await store.setMany([
      ["b", [1, 2]],
      ["c", "three"],
    ]);
    expect(await store.get("a")).toEqual({ n: 1 });
    expect(await store.get("b")).toEqual([1, 2]);
    expect(await store.get("c")).toBe("three");
  });

  it("reads a database laid out the way idb-keyval created it", async () => {
    // idb-keyval: indexedDB.open(name) without a version, one out-of-line-key store.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("kv-legacy");
      req.onupgradeneeded = () => {
        req.result.createObjectStore("recents");
      };
      req.onerror = () => {
        reject(req.error ?? new Error("open failed"));
      };
      req.onsuccess = () => {
        const tx = req.result.transaction("recents", "readwrite");
        tx.objectStore("recents").put(["old"], "recents");
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
    });
    const store = createKeyValueStore("kv-legacy", "recents");
    expect(await store.get("recents")).toEqual(["old"]);
  });
});
