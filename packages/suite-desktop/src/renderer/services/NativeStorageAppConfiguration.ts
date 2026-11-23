// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Mutex } from "async-mutex";

import {
  AppConfigurationListeners,
  AppConfigurationValue,
  IAppConfiguration,
} from "@lichtblick/suite-base";

import { SETTINGS_DATASTORE_NAME, SETTINGS_JSON_DATASTORE_KEY } from "../../common/storage";
import { Storage } from "../../common/types";

export default class NativeStorageAppConfiguration
  extends AppConfigurationListeners
  implements IAppConfiguration
{
  static #STORE_NAME = SETTINGS_DATASTORE_NAME;
  static #STORE_KEY = SETTINGS_JSON_DATASTORE_KEY;

  readonly #ctx: Storage;

  // Protect access to currentValue to avoid read-modify-write races between multiple set() calls.
  #mutex = new Mutex();
  #currentValue: Record<string, AppConfigurationValue>;

  // Use OsContextAppConfiguration.initialize to create a new instance
  private constructor(ctx: Storage, initialValue: Record<string, AppConfigurationValue>) {
    super();
    this.#ctx = ctx;
    this.#currentValue = initialValue;
  }

  // create a new OsContextAppConfiguration
  public static async Initialize(
    ctx: Storage,
    options: { defaults?: { [key: string]: AppConfigurationValue } } = {},
  ): Promise<NativeStorageAppConfiguration> {
    const { defaults } = options;
    const value = await ctx.get(
      NativeStorageAppConfiguration.#STORE_NAME,
      NativeStorageAppConfiguration.#STORE_KEY,
    );
    const currentValue = JSON.parse(value ?? "{}") as Record<string, AppConfigurationValue>;
    const config = new NativeStorageAppConfiguration(ctx, { ...defaults, ...currentValue });

    return config;
  }

  public get(key: string): AppConfigurationValue | undefined {
    return this.#currentValue[key];
  }

  public async set(key: string, value: AppConfigurationValue): Promise<void> {
    await this.#mutex.runExclusive(async () => {
      const currentConfig = await this.#ctx.get(
        NativeStorageAppConfiguration.#STORE_NAME,
        NativeStorageAppConfiguration.#STORE_KEY,
      );

      const newConfig: Record<string, AppConfigurationValue> = {
        ...JSON.parse(currentConfig ?? "{}"),
        [key]: value,
      };

      await this.#ctx.put(
        NativeStorageAppConfiguration.#STORE_NAME,
        NativeStorageAppConfiguration.#STORE_KEY,
        JSON.stringify(newConfig) ?? "",
      );
      this.#currentValue = newConfig;
    });
    this.notify(key, value);
  }
}
