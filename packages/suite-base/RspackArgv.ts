// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

type RspackArgv = {
  mode?: string;
  env?: {
    RSPACK_SERVE?: boolean;
    WEBPACK_BUNDLE?: boolean;
    WEBPACK_BUILD?: boolean;
  };
  host?: string;
};

type ConfigFactory<C> = C | ((env: unknown, argv: RspackArgv) => C);

/**
 * webpack-cli called functions inside an exported config array; the Rspack CLI only calls a
 * top-level function. Export `(env, argv) => resolveConfigs(env, argv, [...])` instead.
 */
function resolveConfigs<C>(env: unknown, argv: RspackArgv, configs: ConfigFactory<C>[]): C[] {
  return configs.map((config) =>
    typeof config === "function"
      ? (config as (env: unknown, argv: RspackArgv) => C)(env, argv)
      : config,
  );
}

export type { RspackArgv };
export { resolveConfigs };
