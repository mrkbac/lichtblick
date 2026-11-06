// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import filterMap from "./filterMap";

describe("filterMap", () => {
  it("maps values and passes the index", () => {
    expect(filterMap([], (x) => x)).toEqual([]);
    expect(filterMap([1, 2, 3], (x, i) => x === i + 1)).toEqual([true, true, true]);
    expect(filterMap(new Set(["a", "b"]), (x, i) => `${x}${i}`)).toEqual(["a0", "b1"]);
  });

  it("drops only undefined and null", () => {
    expect(filterMap([0, 1, 2], () => undefined)).toEqual([]);
    expect(filterMap([0, 1, 2], () => null)).toEqual([]);
    expect(filterMap([0, 1, 2], (x) => (x === 1 ? undefined : x))).toEqual([0, 2]);
  });

  it("keeps other falsy values", () => {
    expect(filterMap([0, 1, 2], (x) => x)).toEqual([0, 1, 2]);
    expect(filterMap([0, 1], (x, i) => (x === 0 ? i : undefined))).toEqual([0]);
    expect(filterMap(["", "a"], (x) => x)).toEqual(["", "a"]);
    expect(filterMap([0], () => false)).toEqual([false]);
    expect(filterMap([0], () => NaN)).toEqual([NaN]);
  });
});
