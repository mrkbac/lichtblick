// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useContext, useEffect, useMemo } from "react";

import { useOnline, useVisibilityState } from "@lichtblick/hooks";
import Logger from "@lichtblick/log";
import LayoutManagerContext from "@lichtblick/suite-base/context/LayoutManagerContext";
import { useLayoutStorage } from "@lichtblick/suite-base/context/LayoutStorageContext";
import { useRemoteLayoutFavoritesStorage } from "@lichtblick/suite-base/context/RemoteLayoutFavoritesStorageContext";
import { useRemoteLayoutStorage } from "@lichtblick/suite-base/context/RemoteLayoutStorageContext";
import { UserProfileStorageContext } from "@lichtblick/suite-base/context/UserProfileStorageContext";
import LayoutManager from "@lichtblick/suite-base/services/LayoutManager/LayoutManager";
import delay from "@lichtblick/suite-base/util/delay";

const log = Logger.getLogger(__filename);

/** Time between syncs while they succeed. Every sync is at least one request per organization. */
const SYNC_INTERVAL_MS = 2 * 60_000;
const RETRY_BASE_MS = 30_000;

/**
 * How long to wait before the next sync: the steady interval (±10% so tabs don't line up) after a
 * success, exponential backoff with full jitter after failures, capped at the steady interval.
 * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export function nextSyncDelayMs(failures: number, random = Math.random()): number {
  if (failures === 0) {
    return SYNC_INTERVAL_MS * (0.9 + 0.2 * random);
  }
  return random * Math.min(SYNC_INTERVAL_MS, RETRY_BASE_MS * 2 ** failures);
}

export default function LayoutManagerProvider({
  children,
}: React.PropsWithChildren): React.JSX.Element {
  const layoutStorage = useLayoutStorage();
  const remoteLayoutStorage = useRemoteLayoutStorage();
  const userProfileStorage = useContext(UserProfileStorageContext);
  const remoteLayoutFavoritesStorage = useRemoteLayoutFavoritesStorage();

  const layoutManager = useMemo(
    () =>
      new LayoutManager({
        local: layoutStorage,
        remote: remoteLayoutStorage,
        userProfile: userProfileStorage,
        remoteFavorites: remoteLayoutFavoritesStorage,
      }),
    [layoutStorage, remoteLayoutStorage, userProfileStorage, remoteLayoutFavoritesStorage],
  );

  const online = useOnline();
  const visibilityState = useVisibilityState();
  useEffect(() => {
    layoutManager.setOnline({ online });
  }, [layoutManager, online]);

  useEffect(() => {
    void layoutManager.loadFavorites();
  }, [layoutManager]);

  // Sync periodically when logged in, online, and the app is not hidden
  const enableSyncing = remoteLayoutStorage != undefined && online && visibilityState === "visible";
  useEffect(() => {
    if (!enableSyncing) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      let failures = 0;
      while (!controller.signal.aborted) {
        try {
          await layoutManager.syncWithRemote(controller.signal);
          failures = 0;
        } catch (error) {
          log.error("Sync failed:", error);
          failures++;
        }
        const duration = nextSyncDelayMs(failures);
        log.debug("Waiting", (duration / 1000).toFixed(2), "sec for next sync", { failures });
        await delay(duration);
      }
    })();
    return () => {
      log.debug("Canceling layout sync due to effect cleanup callback");
      controller.abort();
    };
  }, [enableSyncing, layoutManager]);

  return (
    <LayoutManagerContext.Provider value={layoutManager}>{children}</LayoutManagerContext.Provider>
  );
}
