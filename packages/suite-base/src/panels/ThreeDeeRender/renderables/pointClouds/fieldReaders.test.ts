// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { NumericType } from "@foxglove/schemas";

import { numericTypeWidth } from "../FoxgloveGrid";
import { getReader, halfToFloat } from "./fieldReaders";

// IEEE 754 binary16 bit patterns and their values
const HALF_CASES: [bits: number, value: number][] = [
  [0x0000, 0],
  [0x8000, -0],
  [0x3c00, 1],
  [0xbc00, -1],
  [0x3555, 0.333251953125],
  [0x4248, 3.140625],
  [0x7bff, 65504], // largest normal
  [0x0400, 2 ** -14], // smallest normal
  [0x03ff, 1023 * 2 ** -24], // largest subnormal
  [0x0001, 2 ** -24], // smallest subnormal
  [0x8001, -(2 ** -24)],
  [0x7c00, Infinity],
  [0xfc00, -Infinity],
];

describe("halfToFloat", () => {
  it.each(HALF_CASES)("decodes bits %i", (bits, value) => {
    expect(Object.is(halfToFloat(bits), value)).toBe(true);
  });

  it("decodes NaN", () => {
    expect(halfToFloat(0x7e00)).toBeNaN();
    expect(halfToFloat(0xfc01)).toBeNaN();
  });

  it("matches DataView.getFloat16 for every bit pattern", () => {
    const view = new DataView(new ArrayBuffer(2));
    const mismatches: string[] = [];
    for (let bits = 0; bits <= 0xffff; bits++) {
      view.setUint16(0, bits, true);
      const native = view.getFloat16(0, true);
      const fallback = halfToFloat(bits);
      // Object.is treats every NaN as equal and tells 0 from -0
      if (!Object.is(native, fallback)) {
        mismatches.push(`0x${bits.toString(16)}: native ${native}, fallback ${fallback}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("FLOAT16 packed fields", () => {
  it("reads little-endian half floats at the field offset", () => {
    const stride = 4;
    const view = new DataView(new ArrayBuffer(stride * 2));
    view.setUint16(2, 0x3c00, true); // point 0: 1
    view.setUint16(6, 0xc248, true); // point 1: -3.140625
    const reader = getReader({ name: "x", offset: 2, type: NumericType.FLOAT16 }, stride);
    expect(reader?.(view, 0)).toBe(1);
    expect(reader?.(view, stride)).toBe(-3.140625);
  });

  it("rejects a field that does not fit in the stride", () => {
    expect(getReader({ name: "x", offset: 3, type: NumericType.FLOAT16 }, 4)).toBeUndefined();
  });

  it("is two bytes wide", () => {
    expect(numericTypeWidth(NumericType.FLOAT16)).toBe(2);
  });
});
