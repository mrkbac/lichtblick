// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { formatLegendNumber } from "./PlotLegendRow";

describe("formatLegendNumber", () => {
  it.each([
    // Counters and seconds timestamps must stay exact, not 1.235e+5 / 1.700e+9
    [123456, "123456"],
    [1700000000, "1700000000"],
    [-42, "-42"],
    [0, "0"],
    [0.5, "0.5000"],
    [1700000000.25, "1700000000.2500"],
    [-99999.5, "-99999.5000"],
    [0.00001234, "1.234e-5"],
    [1.5e20, "150000000000000000000"],
    [1.25e20 + 0.5, "125000000000000000000"],
    [Number.NaN, "NaN"],
  ])("formats %d as %s", (value, expected) => {
    expect(formatLegendNumber(value)).toBe(expected);
  });
});
