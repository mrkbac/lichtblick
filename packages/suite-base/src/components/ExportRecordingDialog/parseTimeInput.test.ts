// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { parseTimeInput } from "./parseTimeInput";

const START = 1_758_901_965_015_110_837n;
const END = START + 19_037_470_959n;
const S = 1_000_000_000n;

describe("parseTimeInput", () => {
  it.each<[string, bigint | undefined]>([
    ["12.5", START + 12n * S + S / 2n],
    ["12,5", START + 12n * S + S / 2n],
    ["500ms", START + S / 2n],
    ["2m", START + 120n * S],
    ["1:02.5", START + 62n * S + S / 2n],
    ["1:00:00", START + 3600n * S],
    ["+5s", START + 5n * S],
    ["@5s", START + 5n * S],
    ["start+5s", START + 5n * S],
    ["-30s", END - 30n * S],
    ["end-1", END - S],
    ["start", START],
    ["end", END],
    // Absolute times pasted from elsewhere
    ["1758901965.015110837", START],
    ["1758901965015110837", START],
    ["2025-09-26T15:52:45.015110837Z", START],
    ["2025-09-26T17:52:45.015110837+02:00", START],
    // Not understood
    ["", undefined],
    ["abc", undefined],
    ["5 parsecs", undefined],
  ])("%s", (input, expected) => {
    expect(parseTimeInput(input, START, END)).toBe(expected);
  });
});
