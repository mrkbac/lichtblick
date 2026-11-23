// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  AppConfigurationListeners,
  AppConfigurationValue,
  IAppConfiguration,
  LOCAL_STORAGE_APP_CONFIGURATION,
} from "@lichtblick/suite-base";

export default class LocalStorageAppConfiguration
  extends AppConfigurationListeners
  implements IAppConfiguration
{
  static #KEY_PREFIX = LOCAL_STORAGE_APP_CONFIGURATION;

  /** Default values for app configuration items which have never been set by a user */
  #defaults?: { [key: string]: AppConfigurationValue };

  public constructor({ defaults }: { defaults?: { [key: string]: AppConfigurationValue } }) {
    super();
    this.#defaults = defaults;
  }

  public get(key: string): AppConfigurationValue {
    const value = localStorage.getItem(LocalStorageAppConfiguration.#KEY_PREFIX + key);
    try {
      return value == undefined ? this.#defaults?.[key] : JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  public async set(key: string, value: AppConfigurationValue): Promise<void> {
    if (value == undefined) {
      localStorage.removeItem(LocalStorageAppConfiguration.#KEY_PREFIX + key);
    } else {
      localStorage.setItem(
        LocalStorageAppConfiguration.#KEY_PREFIX + key,
        JSON.stringify(value) ?? "",
      );
    }
    this.notify(key, value);
  }
}
