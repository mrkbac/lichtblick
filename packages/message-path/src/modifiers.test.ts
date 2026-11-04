// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { applyModifier, modifierResultStructure, modifierSuggestions } from "./modifiers";
import { MessagePathModifierArg, MessagePathStructureItem } from "./types";

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
    [1, "valueOf", [], undefined],
  ])("%p.@%s(%p) = %p", (value, name, args, expected) => {
    expect(apply(value, name, args)).toEqual(expected);
  });

  it("reduces arrays too large to spread into Math.max", () => {
    expect(apply(new Float64Array(200_000).fill(1), "max")).toBe(1);
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

  type Quaternion = { x: number; y: number; z: number; w: number };
  const axisAngle = (axis: "x" | "y" | "z", angle: number): Quaternion => ({
    x: 0,
    y: 0,
    z: 0,
    [axis]: Math.sin(angle / 2),
    w: Math.cos(angle / 2),
  });
  const multiply = (a: Quaternion, b: Quaternion): Quaternion => ({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
  // Intrinsic rotations in the given axis order
  const compose = (...rotations: [axis: "x" | "y" | "z", angle: number][]) =>
    rotations.map(([axis, angle]) => axisAngle(axis, angle)).reduce(multiply);

  it.each([
    ["rpy", compose(["x", 0.3], ["y", 0.2], ["z", 0.5])],
    ["ypr", compose(["z", 0.5], ["y", 0.2], ["x", 0.3])],
    ["yrp", compose(["z", 0.5], ["x", 0.3], ["y", 0.2])],
  ])("extracts intrinsic Euler angles with .@%s", (name, quaternion) => {
    const result = apply(quaternion, name) as Record<string, number>;
    expect(result.roll).toBeCloseTo(0.3);
    expect(result.pitch).toBeCloseTo(0.2);
    expect(result.yaw).toBeCloseTo(0.5);
  });

  it("uses the order to tell rpy, ypr and yrp apart", () => {
    const quaternion = compose(["z", 0.5], ["y", 0.2], ["x", 0.3]);
    expect((apply(quaternion, "rpy") as Record<string, number>).yaw).not.toBeCloseTo(0.5);
  });

  it("composes .@quat as intrinsic XYZ", () => {
    const quaternion = apply({ roll: 0.3, pitch: 0.2, yaw: 0.5 }, "quat") as Quaternion;
    const expected = compose(["x", 0.3], ["y", 0.2], ["z", 0.5]);
    for (const key of ["x", "y", "z", "w"] as const) {
      expect(quaternion[key]).toBeCloseTo(expected[key]);
    }
  });

  it("reports the last axis as 0 at gimbal lock", () => {
    const result = apply(compose(["x", 0.4], ["y", Math.PI / 2]), "rpy") as Record<string, number>;
    expect(result.pitch).toBeCloseTo(Math.PI / 2);
    expect(result.roll).toBeCloseTo(0.4);
    expect(result.yaw).toBe(0);
  });

  it("drops a zero-length quaternion", () => {
    expect(apply({ x: 0, y: 0, z: 0, w: 0 }, "ypr")).toBeUndefined();
  });
});

describe("modifierResultStructure", () => {
  const float64: MessagePathStructureItem = {
    structureType: "primitive",
    primitiveType: "float64",
    datatype: "",
  };
  const string: MessagePathStructureItem = {
    structureType: "primitive",
    primitiveType: "string",
    datatype: "",
  };
  const floats: MessagePathStructureItem = { structureType: "array", next: float64, datatype: "" };
  const quaternion: MessagePathStructureItem = {
    structureType: "message",
    datatype: "geometry_msgs/Quaternion",
    nextByName: { x: float64, y: float64, z: float64, w: float64 },
  };
  const rpy = expect.objectContaining({
    nextByName: { roll: float64, pitch: float64, yaw: float64 },
  });

  it.each<[string, boolean, MessagePathStructureItem | undefined, unknown]>([
    ["abs", false, float64, float64],
    ["abs", false, floats, floats],
    ["abs", false, string, undefined],
    ["abs", false, quaternion, undefined],
    ["mul", true, float64, float64],
    ["mul", false, float64, undefined],
    ["max", false, floats, float64],
    ["max", false, float64, undefined],
    ["max", true, floats, floats],
    ["sum", true, quaternion, float64],
    ["length", false, floats, float64],
    ["norm", false, quaternion, float64],
    ["rpy", false, quaternion, rpy],
    ["rpy", false, floats, undefined],
    ["ypr", false, quaternion, rpy],
    ["yrp", false, quaternion, rpy],
    ["quat", false, quaternion, undefined],
    ["nope", false, float64, undefined],
    ["nope", false, undefined, undefined],
    ["valueOf", false, float64, undefined],
    ["__proto__", false, undefined, undefined],
    ["abs", false, undefined, float64],
    ["rpy", false, undefined, rpy],
  ])(".@%s (args: %p) on %p", (name, hasArgs, input, expected) => {
    expect(modifierResultStructure({ name, args: hasArgs ? [1] : [] }, input)).toEqual(expected);
  });

  it("suggests only modifiers that apply to the input", () => {
    expect(modifierSuggestions(quaternion, { streamModifiers: true })).toEqual([
      "norm",
      "rpy",
      "ypr",
      "yrp",
    ]);
    expect(modifierSuggestions(floats, { streamModifiers: true })).toEqual(
      expect.arrayContaining(["abs", "mul(1)", "max", "length", "norm"]),
    );
    expect(modifierSuggestions(floats, { streamModifiers: true })).not.toContain("delta");
    expect(modifierSuggestions(float64, { streamModifiers: false })).not.toContain("delta");
    expect(modifierSuggestions(float64, { streamModifiers: true })).toContain("delta");
  });
});
