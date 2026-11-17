// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { BuiltinPanelExtensionContext } from "@lichtblick/suite-base/components/PanelExtensionAdapter";

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export type IndicatorOperator = "=" | "<" | "<=" | ">" | ">=";

export type IndicatorStyle = "bulb" | "background";

export type IndicatorAlertSound = "none" | "beep" | "chime" | "alarm";

export type IndicatorRule = {
  /** undefined once cleared in the settings: the fallback color */
  color?: string;
  label: string;
  operator: IndicatorOperator;
  rawValue: string;
  /** Sound played when this rule becomes the matching rule. */
  alertSound?: IndicatorAlertSound;
  /** Show a browser notification when this rule becomes the matching rule. */
  alertNotify?: boolean;
};

export type RawValueIndicator =
  | undefined
  | boolean
  | bigint
  | number
  | string
  | { data?: boolean | bigint | number | string };

export type IndicatorConfig = {
  /** undefined once cleared in the settings: DEFAULT_FALLBACK_COLOR */
  fallbackColor?: string;
  fallbackLabel: string;
  path: string;
  rules: IndicatorRule[];
  style: IndicatorStyle;
  /** Silences all rule alerts of this panel. */
  alertsMuted?: boolean;
};

export type IndicatorProps = {
  context: BuiltinPanelExtensionContext;
};
