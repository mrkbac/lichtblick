// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";

const LOCK_PREFIX = "lichtblick-tab:";
const PRESENCE_CHANNEL_NAME = "lichtblick-tab-presence";
// A closed or crashed tab sends nothing; polling picks it up.
const POLL_INTERVAL_MS = 3000;

/**
 * Number of other Lichtblick tabs (same origin) that are using this hook right now.
 *
 * Each tab holds a Web Lock while mounted. The browser releases it when the tab closes or crashes,
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

    const ownName = `${LOCK_PREFIX}${crypto.randomUUID()}`;
    const channel = new BroadcastChannel(PRESENCE_CHANNEL_NAME);
    let active = true;

    const refresh = async () => {
      const { held = [] } = await locks.query();
      if (!active) {
        return;
      }
      setCount(
        held.filter((lock) => lock.name?.startsWith(LOCK_PREFIX) === true && lock.name !== ownName)
          .length,
      );
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
