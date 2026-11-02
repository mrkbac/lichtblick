// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "accent" });

const DECIMAL = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;

/** Numbers and decimal strings compare by value ("2.09" < "2.1"); everything else naturally. */
function sortFn(a: string | number, b: string | number): number {
  const numA = typeof a === "number" ? a : DECIMAL.test(a) ? Number(a) : undefined;
  const numB = typeof b === "number" ? b : DECIMAL.test(b) ? Number(b) : undefined;
  if (numA != undefined && numB != undefined) {
    return numA - numB;
  }
  return collator.compare(String(a), String(b));
}

type StringOrNumberFields<T> =
  T extends Record<string, unknown>
    ? { [K in keyof T]: T[K] extends string | number ? K : never }[keyof T]
    : never;

function naturalSort(): typeof sortFn;
function naturalSort<T, K extends StringOrNumberFields<T>>(key: K): (a: T, b: T) => number;
function naturalSort<T, K extends StringOrNumberFields<T>>(key?: K): unknown {
  return key == undefined
    ? sortFn
    : (a: T, b: T) =>
        sortFn(a[key] as unknown as string | number, b[key] as unknown as string | number);
}

export default naturalSort;
