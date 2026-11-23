// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  AppConfigurationListeners,
  AppConfigurationValue,
  IAppConfiguration,
} from "@lichtblick/suite-base";

/**
 * MemoryAppConfiguration implements IAppConfiguration by storing and reading configuration from
 * memory.
 *
 * Configuration does not survive any reload nor is it persisted.
 */
export class MemoryAppConfiguration extends AppConfigurationListeners implements IAppConfiguration {
  #values = new Map<string, AppConfigurationValue>();

  public constructor({ defaults }: { defaults?: { [key: string]: AppConfigurationValue } }) {
    super();
    if (defaults) {
      for (const [key, value] of Object.entries(defaults)) {
        this.#values.set(key, value);
      }
    }
  }

  public get(key: string): AppConfigurationValue {
    return this.#values.get(key);
  }
  public async set(key: string, value: AppConfigurationValue): Promise<void> {
    this.#values.set(key, value);
    this.notify(key, value);
  }
}
