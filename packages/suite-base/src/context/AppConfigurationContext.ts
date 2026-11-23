// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext } from "react";

// individual app configuration values are basic primitive types
export type AppConfigurationValue = string | number | boolean | undefined;

export type ChangeHandler = (newValue: AppConfigurationValue) => void;

// Exposes an interface for reading and writing user-configurable options and other persistent application state.
export interface IAppConfiguration {
  // get the current value for the key
  get(key: string): AppConfigurationValue;
  // set key to value - This returns a promise to track the progress for setting the value
  set(key: string, value: AppConfigurationValue): Promise<void>;
  // register a change handler for a particular key
  addChangeListener(key: string, cb: ChangeHandler): void;
  // remove a change handler on a given key
  removeChangeListener(key: string, cb: ChangeHandler): void;
}

/** The per-key change listeners every IAppConfiguration needs; call `notify` after a set. */
export abstract class AppConfigurationListeners {
  readonly #listeners = new Map<string, Set<ChangeHandler>>();

  public addChangeListener(key: string, cb: ChangeHandler): void {
    let listeners = this.#listeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(key, listeners);
    }
    listeners.add(cb);
  }

  public removeChangeListener(key: string, cb: ChangeHandler): void {
    this.#listeners.get(key)?.delete(cb);
  }

  protected notify(key: string, value: AppConfigurationValue): void {
    // Copy the listeners to protect against mutation during iteration
    for (const listener of [...(this.#listeners.get(key) ?? [])]) {
      listener(value);
    }
  }
}

const AppConfigurationContext = createContext<IAppConfiguration | undefined>(undefined);
AppConfigurationContext.displayName = "AppConfigurationContext";

export function useAppConfiguration(): IAppConfiguration {
  const storage = useContext(AppConfigurationContext);
  if (!storage) {
    throw new Error("An AppConfigurationContext provider is required to useAppConfiguration");
  }
  return storage;
}

export default AppConfigurationContext;
