// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { DependencyList } from "react";

declare module "react" {
  // @types/react uses `any` here, which silences helpful TypeScript errors
  // https://github.com/microsoft/TypeScript/issues/37595
  function useCallback<T extends (...args: never[]) => unknown>(
    callback: T,
    deps: DependencyList,
  ): T;
}
