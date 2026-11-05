// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { copyText, formatExpanded, formatValue, isExpandable, toPlottable } from "./format";

describe("formatValue", () => {
  it("formats numbers with automatic or fixed precision", () => {
    expect(formatValue(12.3456789, undefined)).toBe("12.3457");
    expect(formatValue(12.3456789, 1)).toBe("12.3");
    expect(formatValue(42, undefined)).toBe("42");
    expect(formatValue(0.00001234, undefined)).toBe("1.234e-5");
    expect(formatValue(NaN, 2)).toBe("NaN");
  });

  it("shows enum names", () => {
    expect(formatValue(1, undefined, { 1: "MOVING" })).toBe("MOVING (1)");
    expect(formatValue(2, undefined, { 1: "MOVING" })).toBe("2");
  });

  it("formats other scalars compactly", () => {
    expect(formatValue("hi", undefined)).toBe('"hi"');
    expect(formatValue(true, undefined)).toBe("true");
    expect(formatValue(10n, undefined)).toBe("10");
    expect(formatValue(undefined, undefined)).toBe("—");
    expect(formatValue({ sec: 1, nsec: 5 }, undefined)).toBe("1.000000005");
  });

  it("summarizes arrays and objects", () => {
    expect(formatValue([1, 2.5, 3, 4, 5], 1)).toBe("(5) [1.0, 2.5, 3.0, 4.0, …]");
    expect(formatValue(new Float32Array([1, 2]), undefined)).toBe("(2) [1, 2]");
    expect(formatValue({ a: 1, b: 2 }, undefined)).toBe("{a, b}");
  });
});

describe("expanded values", () => {
  it("expands arrays and objects only", () => {
    expect(isExpandable({ a: 1 })).toBe(true);
    expect(isExpandable([1])).toBe(true);
    expect(isExpandable([])).toBe(false);
    expect(isExpandable(1)).toBe(false);
    expect(isExpandable({ sec: 1, nsec: 2 })).toBe(false);
  });

  it("truncates long arrays and handles bigints", () => {
    const text = formatExpanded({ data: new Uint8Array(205), big: 1n });
    expect(text).toContain("… 5 more");
    expect(text).toContain('"big": "1"');
  });

  it("copies full precision values", () => {
    expect(copyText(1.23456789)).toBe("1.23456789");
    expect(copyText("raw")).toBe("raw");
    expect(copyText(undefined)).toBe("");
    expect(JSON.parse(copyText(new Array(300).fill(1))) as unknown[]).toHaveLength(300);
    const floats = new Float64Array(300);
    floats[250] = NaN;
    floats[251] = -Infinity;
    expect((JSON.parse(copyText(floats)) as unknown[]).slice(250, 252)).toEqual([
      "NaN",
      "-Infinity",
    ]);
  });

  it("converts plottable values", () => {
    expect(toPlottable(true)).toBe(1);
    expect(toPlottable(3n)).toBe(3);
    expect(toPlottable(Infinity)).toBeUndefined();
    expect(toPlottable("1")).toBeUndefined();
  });
});
