/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { loadSavedSources } from "./savedSources";

describe("loadSavedSources", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("keeps valid entries when a stored entry is malformed", () => {
    localStorage.setItem(
      "lichtblick.map.savedSources",
      '[null, 3, {"kind": "raster", "url": "https://example.com/{z}/{x}/{y}.png"}]',
    );
    expect(loadSavedSources()).toEqual([
      { kind: "raster", url: "https://example.com/{z}/{x}/{y}.png" },
    ]);
  });
});
