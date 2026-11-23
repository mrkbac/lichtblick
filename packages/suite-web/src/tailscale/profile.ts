// SPDX-License-Identifier: MPL-2.0

import { type DBSchema, openDB } from "idb";

type State = Record<string, string>;

interface ProfileDatabase extends DBSchema {
  keys: { key: string; value: CryptoKey };
  profiles: { key: string; value: { iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer } };
}

async function openDatabase() {
  return await openDB<ProfileDatabase>("lichtblick-tailscale", 1, {
    upgrade(database) {
      database.createObjectStore("keys");
      database.createObjectStore("profiles");
    },
  });
}

export async function forgetProfile(): Promise<void> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(["keys", "profiles"], "readwrite");
    await Promise.all([
      tx.objectStore("keys").clear(),
      tx.objectStore("profiles").clear(),
      tx.done,
    ]);
  } finally {
    db.close();
  }
}

/** Go's reads are synchronous. Hydrate before starting the node and serialize its writes. */
export async function openProfile(): Promise<{
  storage: { getState(id: string): string; setState(id: string, value: string): void };
  flush(): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}> {
  const db = await openDatabase();
  try {
    let key = await db.get("keys", "device");
    if (!key) {
      key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
      await db.put("keys", key, "device");
    }
    const deviceKey = key;
    const saved = await db.get("profiles", "device");
    const state = new Map<string, string>(
      saved
        ? Object.entries(
            JSON.parse(
              new TextDecoder().decode(
                await crypto.subtle.decrypt(
                  { name: "AES-GCM", iv: saved.iv },
                  deviceKey,
                  saved.ciphertext,
                ),
              ),
            ) as State,
          )
        : [],
    );
    let pending = Promise.resolve();
    let failed = false;
    let cleared = false;
    // Persist the latest state. A failed write must not block later ones; flush sees the result.
    const write = () => {
      pending = pending
        .catch(() => {})
        .then(async () => {
          const bytes = new TextEncoder().encode(JSON.stringify(Object.fromEntries(state)));
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, deviceKey, bytes);
          await db.put("profiles", { iv, ciphertext }, "device");
          failed = false;
        });
      // flush reports persistence failures to the session.
      void pending.catch(() => {
        failed = true;
      });
    };
    return {
      storage: {
        getState: (id: string) => state.get(id) ?? "",
        setState(id: string, value: string) {
          if (cleared) {
            return;
          }
          state.set(id, value);
          write();
        },
      },
      flush: async () => {
        // Retry the latest state after a failed write, so a recovered store catches up.
        if (failed && !cleared) {
          write();
        }
        // Writes queued while waiting replace `pending`; drain until it settles.
        let current: Promise<void>;
        do {
          current = pending;
          await current;
        } while (current !== pending);
      },
      async clear() {
        cleared = true;
        state.clear();
        await pending.catch(() => {});
        await forgetProfile();
      },
      close: () => {
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
