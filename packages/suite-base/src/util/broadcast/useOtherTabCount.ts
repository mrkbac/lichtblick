// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";

const LOCK_PREFIX = "lichtblick-tab:";
const PRESENCE_CHANNEL_NAME = "lichtblick-tab-presence";
// A closed or crashed tab sends nothing; polling picks it up.
const POLL_INTERVAL_MS = 3000;
// One id per tab: every mount in this tab shares it, so several toggles in one tab count as one.
// Not crypto.randomUUID(): it only exists in secure contexts and this runs at import.
const randomId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const TAB_ID = randomId();

/**
 * Number of other Lichtblick tabs (same origin) that are using this hook right now.
 *
 * Each mount holds a Web Lock named after its tab. The browser releases it when the tab closes or crashes,
 * so `navigator.locks.query()` is an exact list of open tabs, even hidden or throttled ones.
 *
 * Returns undefined when the Web Locks API is unavailable (insecure context, old browser).
 */
export function useOtherTabCount(): number | undefined {
  const [count, setCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    // Not in every lib.dom / runtime (e.g. jsdom, http:// on a LAN address).
    const locks = (navigator as Partial<Navigator>).locks;
    if (locks == undefined) {
      return;
    }

    const ownName = `${LOCK_PREFIX}${TAB_ID}:${randomId()}`;
    const channel = new BroadcastChannel(PRESENCE_CHANNEL_NAME);
    let active = true;

    const refresh = async () => {
      let held: LockInfo[];
      try {
        ({ held = [] } = await locks.query());
      } catch {
        // Treat a failing Web Locks API like a missing one.
        if (active) {
          setCount(undefined);
        }
        return;
      }
      if (!active) {
        return;
      }
      const tabs = new Set<string>();
      for (const { name } of held) {
        if (name?.startsWith(LOCK_PREFIX) === true) {
          tabs.add(name.slice(LOCK_PREFIX.length).split(":")[0]!);
        }
      }
      tabs.delete(TAB_ID);
      setCount(tabs.size);
    };
    const onChange = () => {
      void refresh();
    };

    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    void locks
      .request(ownName, async () => {
        channel.postMessage("changed");
        await refresh();
        await released;
      })
      .catch(() => {
        if (active) {
          setCount(undefined);
        }
      })
      .finally(() => {
        // Our lock is gone now: tell the other tabs to recount, then close.
        channel.postMessage("changed");
        channel.close();
      });

    channel.onmessage = onChange;
    document.addEventListener("visibilitychange", onChange);
    const interval = setInterval(onChange, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onChange);
      release();
    };
  }, []);

  return count;
}
