// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/* eslint-disable @typescript-eslint/no-explicit-any */

// We extend the type definition of JSON.stringify because in some cases
// it can return undefined. This isn't strictly correct but it at least
// forces callers to handle the undefined case and prevent crashes.
// See issue https://github.com/microsoft/TypeScript/issues/18879
declare global {
  // https://developer.mozilla.org/en-US/docs/Web/API/Launch_Handler_API (installed PWA file_handlers)
  interface LaunchParams {
    readonly files: readonly FileSystemHandle[];
    readonly targetURL?: string;
  }
  interface Window {
    launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
  }

  interface JSON {
    stringify(
      value: any,
      replacer?: (this: any, key: string, value: any) => any,
      space?: string | number,
    ): undefined | string;

    stringify(
      value: any,
      replacer?: (number | string)[] | null,
      space?: string | number,
    ): undefined | string;
  }

  interface String {
    toUpperCase<T extends string>(this: T): Uppercase<T>;
    toLowerCase<T extends string>(this: T): Lowercase<T>;
  }
}

export {};
