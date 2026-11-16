// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { Code, ident, int, js, Unsupported } from "./codegen";

describe("codegen", () => {
  it("only splices Code values into js templates", () => {
    expect(js`a.${ident("b")} = ${int(3)};`.toString()).toBe("a.b = 3;");
    const raw = "1); evil(); (" as unknown as Code;
    expect(() => js`f(${raw})`).toThrow(Unsupported);
  });

  it("only makes Code from plain identifiers and non-negative integers", () => {
    for (const name of ["a b", "a;b", "a.b", "1a", "", "__proto__", "a\nb", 3]) {
      expect(() => ident(name)).toThrow(Unsupported);
    }
    for (const value of [-1, 1.5, NaN, Infinity, 2 ** 53, "1", "1); evil(", undefined]) {
      expect(() => int(value)).toThrow(Unsupported);
    }
    expect(ident("frame_id").toString()).toBe("frame_id");
    expect(int(0).toString()).toBe("0");
  });

  it("does not let other modules construct Code", () => {
    const Ctor = Code as unknown as new (token: symbol, text: string) => Code;
    expect(() => new Ctor(Symbol("trusted"), "evil()")).toThrow();
  });
});
