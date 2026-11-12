// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { getDeepLinks, toLichtblickDeepLink } from "./deepLinks";

describe("toLichtblickDeepLink", () => {
  it("passes lichtblick:// links through, whatever the setting", () => {
    expect(toLichtblickDeepLink("lichtblick://open?ds=x", { acceptFoxglove: false })).toBe(
      "lichtblick://open?ds=x",
    );
    expect(toLichtblickDeepLink("lichtblick://signin-complete", { acceptFoxglove: true })).toBe(
      "lichtblick://signin-complete",
    );
    expect(toLichtblickDeepLink("Lichtblick://open", { acceptFoxglove: false })).toBe(
      "Lichtblick://open",
    );
  });

  it("ignores foxglove:// links unless opted in", () => {
    expect(toLichtblickDeepLink("foxglove://open?ds=x", { acceptFoxglove: false })).toBeUndefined();
  });

  it("rewrites foxglove://open links when opted in", () => {
    expect(toLichtblickDeepLink("foxglove://open?ds=x", { acceptFoxglove: true })).toBe(
      "lichtblick://open?ds=x",
    );
    expect(toLichtblickDeepLink("FOXGLOVE://open/?ds=x", { acceptFoxglove: true })).toBe(
      "lichtblick://open/?ds=x",
    );
    expect(toLichtblickDeepLink("foxglove://open", { acceptFoxglove: true })).toBe(
      "lichtblick://open",
    );
  });

  it("never accepts other foxglove:// hosts", () => {
    expect(
      toLichtblickDeepLink("foxglove://signin-complete", { acceptFoxglove: true }),
    ).toBeUndefined();
    expect(
      toLichtblickDeepLink("foxglove://opener?ds=x", { acceptFoxglove: true }),
    ).toBeUndefined();
  });

  it("ignores files, flags and other schemes", () => {
    for (const arg of ["/tmp/example.mcap", "--flag", "https://example.com", "web+lichtblick:x"]) {
      expect(toLichtblickDeepLink(arg, { acceptFoxglove: true })).toBeUndefined();
    }
  });
});

describe("getDeepLinks", () => {
  const argv = ["--flag", "lichtblick://open?ds=a", "/tmp/example.mcap", "foxglove://open?ds=b"];

  it("keeps only lichtblick:// links when not opted in", () => {
    expect(getDeepLinks(argv, { acceptFoxglove: false })).toEqual(["lichtblick://open?ds=a"]);
  });

  it("translates foxglove://open links when opted in", () => {
    expect(getDeepLinks(argv, { acceptFoxglove: true })).toEqual([
      "lichtblick://open?ds=a",
      "lichtblick://open?ds=b",
    ]);
  });
});
