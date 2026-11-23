// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { lowerBound, upperBound } from "./sortedSearch";

describe("sortedSearch", () => {
  const xs = [1, 2, 2, 3];

  it("upperBound finds the first value after", () => {
    expect(upperBound(xs, 0, 4, 0)).toBe(0);
    expect(upperBound(xs, 0, 4, 2)).toBe(3);
    expect(upperBound(xs, 0, 4, 2.5)).toBe(3);
    expect(upperBound(xs, 0, 4, 9)).toBe(4);
    expect(upperBound(xs, 0, 2, 9)).toBe(2);
  });

  it("lowerBound finds the first value at or after", () => {
    expect(lowerBound(xs, 0, 4, 2)).toBe(1);
    expect(lowerBound(xs, 2, 4, 2)).toBe(2);
    expect(lowerBound(xs, 0, 4, 9)).toBe(4);
  });
});
