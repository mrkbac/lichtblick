// SPDX-License-Identifier: MPL-2.0

import { join } from "path";

import { resolveInside } from "./resolveInside";

describe("resolveInside", () => {
  it("allows paths inside the root and rejects the root itself and escapes", () => {
    expect(resolveInside("/root", "a/b.js")).toBe(join("/root", "a/b.js"));
    expect(resolveInside("/root", "..foo")).toBe(join("/root", "..foo"));
    for (const bad of ["", ".", "..", "../x", "a/../../x", "/etc/passwd"]) {
      expect(() => resolveInside("/root", bad)).toThrow("escapes");
    }
  });
});
