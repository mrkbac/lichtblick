// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AppParametersEnum } from "@lichtblick/suite-base/AppParameters";
import { useSharedRootContext } from "@lichtblick/suite-base/context/SharedRootContext";

// Defines a type for input parameters, allowing any string keys with string values.
export type AppParametersInput = Readonly<Record<string, string>>;

// Defines a type for application parameters, restricting keys to the AppParametersEnum for type-safe usage.
export type AppParameters = Readonly<Record<AppParametersEnum, string | undefined>>;

const EMPTY_PARAMETERS: AppParametersInput = {};

export function useAppParameters(): AppParameters {
  return useSharedRootContext().appParameters ?? EMPTY_PARAMETERS;
}
