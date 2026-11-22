// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BRAND, dark, light } from "./palette";

const BRAND_COLORS = new Set(
  [...Object.values(BRAND.orange), ...Object.values(BRAND.stone), "#ffffff"].map((c) =>
    c.toLowerCase(),
  ),
);

/** Error, warning, success and info keep their meaning, so they are not brand colors. */
const SEMANTIC = new Set(["error", "warning", "success", "info"]);

function colors(value: unknown, at: string): [string, string][] {
  if (typeof value === "string") {
    return value.startsWith("#") ? [[at, value.toLowerCase()]] : [];
  }
  if (value == undefined || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, v]) =>
    SEMANTIC.has(key) ? [] : colors(v, `${at}.${key}`),
  );
}

describe("corporate identity", () => {
  it.each([
    ["dark", dark],
    ["light", light],
  ])("%s palette only uses brand colors", (_name, palette) => {
    const offBrand = colors(palette, "palette").filter(([, c]) => !BRAND_COLORS.has(c));
    expect(offBrand).toEqual([]);
  });

  it("app icon only uses brand colors", () => {
    const svg = readFileSync(
      path.join(__dirname, "../../suite-desktop/resources/icon/icon.svg"),
      "utf8",
    );
    const used = (svg.match(/#[0-9a-f]{3,6}\b/gi) ?? []).map((c) =>
      c.toLowerCase() === "#fff" ? "#ffffff" : c.toLowerCase(),
    );
    expect(used.filter((c) => !BRAND_COLORS.has(c))).toEqual([]);
  });
});
