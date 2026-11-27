// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useSyncExternalStore } from "react";

import Log from "@lichtblick/log";

const log = Log.getLogger(__filename);

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
  };
}

type SessionStorageValue = [
  value: string | undefined,
  setValue: (newValue: string | undefined) => void,
];

/**
 * This provides a convenience wrapper around sessionStorage and triggers
 * a react state change when values change.
 *
 * @param key sessionStorage key to manage.
 * @returns [value, setValue] tuple for that key.
 */
export function useSessionStorageValue(key: string): SessionStorageValue {
  // Storage access throws where site data is blocked: read as unset instead of crashing the app
  const value = useSyncExternalStore(subscribe, () => {
    try {
      return sessionStorage.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  });

  const setValue = useCallback(
    (newValue: string | undefined) => {
      // Hack a manual event for now. Unfortunately the browser only fires "storage"
      // events when triggered outside our current tab.
      try {
        if (newValue) {
          sessionStorage.setItem(key, newValue);
        } else {
          sessionStorage.removeItem(key);
        }
      } catch (error: unknown) {
        // blocked storage or QuotaExceededError: the value just isn't kept
        log.warn(`Unable to store ${key} in session storage`, error);
        return;
      }
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: newValue === "" ? undefined : newValue,
          storageArea: sessionStorage,
        }),
      );
    },
    [key],
  );

  return [value, setValue];
}
