// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { stringToRgba } from "@lichtblick/suite-base/panels/ThreeDeeRender/color";
import { isLight, parseColor, toHex6, toHex8 } from "@lichtblick/suite-base/util/parseColor";
import { darkColor, lightColor } from "@lichtblick/suite-base/util/plotColors";

describe("parseColor", () => {
  it("accepts names, bare hex, padding and css functions", () => {
    expect(toHex8(parseColor("Red"))).toBe("#ff0000ff");
    expect(toHex8(parseColor(" abc "))).toBe("#aabbccff");
    expect(toHex8(parseColor("ff000080"))).toBe("#ff000080");
    expect(toHex8(parseColor("transparent"))).toBe("#00000000");
    expect(toHex8(parseColor("rgba(10, 20, 30, 0.5)"))).toBe("#0a141e80");
    expect(parseColor("nope").isValid()).toBe(false);
    expect(parseColor("#12345").isValid()).toBe(false);
  });

  it("keeps the exact alpha byte of hex colors", () => {
    // colord alone rounds alpha to 2 decimals, which turns 0x81 into 0x82
    expect(toHex8(parseColor("#12345681"))).toBe("#12345681");
    expect(parseColor("#00000001").rgba.a).toBe(1 / 255);
    expect(toHex8(parseColor("#1238"))).toBe("#11223388");
  });

  it("formats hex with and without alpha regardless of opacity", () => {
    expect(toHex8(parseColor("#aabbcc"))).toBe("#aabbccff");
    expect(toHex6(parseColor("#aabbcc80"))).toBe("#aabbcc");
  });

  it("uses a brightness threshold of 128", () => {
    // brightness 127.64: colord's isLight() says light, the 128 threshold says dark
    expect(isLight(parseColor("#9a8b00"))).toBe(false);
    expect(isLight(parseColor("#808080"))).toBe(true);
  });

  it("parses 3D colors with exact alpha", () => {
    const out = { r: 0, g: 0, b: 0, a: 0 };
    expect(stringToRgba(out, "#ff000080")).toEqual({ r: 1, g: 0, b: 0, a: 128 / 255 });
    expect(stringToRgba(out, "garbage")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });

  it("derives plot contrast colors with percent amounts", () => {
    // brighten(15) adds round(0.15 * 255) = 38 to each channel; darken(30) lowers HSL lightness by 30
    expect(lightColor("#4e98e2")).toBe("#74beff");
    expect(darkColor("#f5774d")).toBe("#a02f09");
  });
});
