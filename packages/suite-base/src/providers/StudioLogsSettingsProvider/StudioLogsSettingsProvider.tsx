// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PropsWithChildren, useEffect, useRef, useState } from "react";

import Log from "@lichtblick/log";
import { SESSION_STORAGE_LOGS_SETTINGS } from "@lichtblick/suite-base/constants/browserStorageKeys";
import { StudioLogsSettingsContext } from "@lichtblick/suite-base/context/StudioLogsSettingsContext";
import { useLocalStorage } from "@lichtblick/suite-base/hooks/useLocalStorage";

import { createStudioLogsSettingsStore } from "./store";
import { LocalStorageSaveState } from "./types";

function StudioLogsSettingsProvider(props: PropsWithChildren): React.JSX.Element {
  const [studioLogsSettingsSavedState, setStudioLogsSettingsSavedState] =
    useLocalStorage<LocalStorageSaveState>(SESSION_STORAGE_LOGS_SETTINGS, {});

  // The store merges channels with the same display name, so its channel list can be shorter than
  // the logger registry. Remember the registry size the store was built from instead.
  const [{ store: studioLogsSettingsStore, registryCount }, setStore] = useState(() => ({
    registryCount: Log.channels().length,
    store: createStudioLogsSettingsStore(studioLogsSettingsSavedState),
  }));

  // To avoid resetting effect below when the localstorage state changes we use a ref for the localstorage state
  const savedStateRef = useRef<LocalStorageSaveState | undefined>(studioLogsSettingsSavedState);
  useEffect(() => {
    savedStateRef.current = studioLogsSettingsSavedState;
  });

  // Re-initialize the settings store when logging channels are added (e.g. by a lazy-loaded chunk)
  // so the settings show them. A chunk adds many channels at once, so the check runs once after.
  useEffect(() => {
    const check = () => {
      const count = Log.channels().length;
      if (count !== registryCount) {
        setStore({
          registryCount: count,
          store: createStudioLogsSettingsStore(savedStateRef.current),
        });
      }
    };
    check(); // channels added before this effect subscribed
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = Log.onChannelAdded(() => {
      timeout ??= setTimeout(check, 0);
    });
    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, [registryCount]);

  useEffect(() => {
    return studioLogsSettingsStore.subscribe((value) => {
      const disabledChannels: string[] = [];

      for (const channel of value.channels) {
        if (!channel.enabled) {
          disabledChannels.push(channel.name);
        }
      }
      setStudioLogsSettingsSavedState({ globalLevel: value.globalLevel, disabledChannels });
    });
  }, [studioLogsSettingsStore, setStudioLogsSettingsSavedState]);

  return (
    <StudioLogsSettingsContext.Provider value={studioLogsSettingsStore}>
      {props.children}
    </StudioLogsSettingsContext.Provider>
  );
}

export { StudioLogsSettingsProvider };
