// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { DEFAULT_CONFIG, migrateConfig, parsePastedPaths } from "./config";

describe("migrateConfig", () => {
  it("returns the default for missing or invalid configs", () => {
    expect(migrateConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(migrateConfig({ rows: "nope", sparklines: 3 })).toEqual(DEFAULT_CONFIG);
  });

  it("keeps valid rows and drops invalid fields", () => {
    const config = migrateConfig({
      sparklines: false,
      rows: [
        { id: "a", path: "/a.x", label: "X", precision: 2, unit: "m" },
        { id: "b", path: "/b", label: "", precision: -1, unit: 5 },
        { id: "c" },
        42,
        null,
      ],
    });
    expect(config).toEqual({
      sparklines: false,
      rows: [
        { id: "a", path: "/a.x", label: "X", precision: 2, unit: "m" },
        { id: "b", path: "/b", label: undefined, precision: undefined, unit: undefined },
      ],
    });
  });

  it("accepts plain path strings and repairs missing or duplicate ids", () => {
    const { rows } = migrateConfig({
      rows: ["/a.x", { id: "x", path: "/b" }, { id: "x", path: "/c" }],
    });
    expect(rows.map((row) => row.path)).toEqual(["/a.x", "/b", "/c"]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    expect(rows[1]!.id).toBe("x");
  });

  it("clamps precision", () => {
    expect(migrateConfig({ rows: [{ path: "/a", precision: 99 }] }).rows[0]!.precision).toBe(15);
  });
});

describe("parsePastedPaths", () => {
  it("splits lines and skips blanks", () => {
    expect(parsePastedPaths(" /a.x \r\n\n/b.y\n")).toEqual(["/a.x", "/b.y"]);
  });
});
