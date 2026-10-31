// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { applyModifier, isKnownModifier } from "./modifiers";
import { MessagePathModifierArg } from "./types";

function apply(value: unknown, name: string, args: MessagePathModifierArg[] = []): unknown {
  return applyModifier(value, { type: "modifier", name, args, repr: name });
}

describe("applyModifier", () => {
  it.each<[unknown, string, MessagePathModifierArg[], unknown]>([
    [-2, "abs", [], 2],
    [3n, "negative", [], -3],
    [Math.PI, "degrees", [], 180],
    [180, "radians", [], Math.PI],
    [180, "deg2rad", [], Math.PI],
    [3 * Math.PI, "wrap_angle", [], -Math.PI],
    [1.2345, "round", [2], 1.23],
    [1.5, "round", [], 2],
    [10, "add", [1, 2], 13],
    [10, "sub", [3], 7],
    [10, "mul", [2, 3], 60],
    [10, "div", [4], 2.5],
    [10, "div", [0], NaN],
    [-5, "max", [0], 0],
    [[1, -2], "abs", [], [1, 2]],
    [new Float32Array([1, 4]), "sqrt", [], [1, 2]],
    [[1, 5, 3], "max", [], 5],
    [[1, 2, 3], "mean", [], 2],
    [[3, 4], "rms", [], Math.sqrt(12.5)],
    [[], "sum", [], 0],
    [[], "mean", [], undefined],
    [{ width: 3, height: 4 }, "product", [["width"], ["height"]], 12],
    [{ a: { b: 2 } }, "sum", [["a", "b"], 5], 7],
    [{ x: 3, y: 4 }, "norm", [], 5],
    [{ x: 1, y: 2, z: 2 }, "magnitude", [], 3],
    [[3, 4], "norm", [], 5],
    [new Uint8Array(4), "length", [], 4],
    ["text", "abs", [], undefined],
    [{ width: 3 }, "product", [["width"], ["missing"]], undefined],
    [10, "mul", [{ variableName: "unfilled", startLoc: 0 }], undefined],
    [1, "unknown", [], undefined],
  ])("%p.@%s(%p) = %p", (value, name, args, expected) => {
    expect(apply(value, name, args)).toEqual(expected);
  });

  it("converts between quaternions and roll/pitch/yaw", () => {
    const rpy = { roll: 0.1, pitch: -0.2, yaw: 1.3 };
    const quaternion = apply(rpy, "quat");
    expect(quaternion).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
      z: expect.any(Number),
      w: expect.any(Number),
    });
    const roundTrip = apply(quaternion, "rpy") as typeof rpy;
    expect(roundTrip.roll).toBeCloseTo(rpy.roll);
    expect(roundTrip.pitch).toBeCloseTo(rpy.pitch);
    expect(roundTrip.yaw).toBeCloseTo(rpy.yaw);
    // 90° yaw
    expect(
      (apply({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }, "rpy") as typeof rpy).yaw,
    ).toBeCloseTo(Math.PI / 2);
  });

  it("knows which modifiers exist", () => {
    expect(isKnownModifier("abs")).toBe(true);
    expect(isKnownModifier("rpy")).toBe(true);
    expect(isKnownModifier("")).toBe(false);
    expect(isKnownModifier("derivative")).toBe(false);
  });
});
