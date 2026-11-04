// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  MessagePathModifier,
  MessagePathModifierArg,
  MessagePathStructureItem,
  MessagePathStructureItemMessage,
} from "./types";

/**
 * Time-series modifiers, computed across messages. At most one per path, followed only by scalar
 * modifiers, see `MessagePath.modifier`.
 */
export const STREAM_MODIFIERS: readonly string[] = ["derivative", "delta", "timedelta", "integral"];

/** Intrinsic Euler orders of the quaternion-to-Euler modifiers. */
const EULER_ORDERS = ["rpy", "ypr", "yrp"];

const DEG_PER_RAD = 180 / Math.PI;

const SCALAR: Record<string, (x: number) => number> = {
  abs: Math.abs,
  negative: (x) => -x,
  sign: Math.sign,
  ceil: Math.ceil,
  floor: Math.floor,
  trunc: Math.trunc,
  sqrt: Math.sqrt,
  log: Math.log,
  log1p: Math.log1p,
  log2: Math.log2,
  log10: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  degrees: (x) => x * DEG_PER_RAD,
  radians: (x) => x / DEG_PER_RAD,
  wrap_angle: (x) => {
    const wrapped = (x + Math.PI) % (2 * Math.PI);
    return (wrapped < 0 ? wrapped + 2 * Math.PI : wrapped) - Math.PI;
  },
  // Legacy names from the Plot panel
  deg2rad: (x) => x / DEG_PER_RAD,
  rad2deg: (x) => x * DEG_PER_RAD,
};

const ARITHMETIC: Record<string, (x: number, args: number[]) => number> = {
  add: (x, args) => args.reduce((acc, a) => acc + a, x),
  sub: (x, args) => args.reduce((acc, a) => acc - a, x),
  mul: (x, args) => args.reduce((acc, a) => acc * a, x),
  div: (x, args) => args.reduce((acc, a) => (a === 0 ? NaN : acc / a), x),
  round: (x, [precision = 0]) => {
    const factor = 10 ** precision;
    return Math.round(x * factor) / factor;
  },
};

const REDUCERS: Record<string, (values: number[]) => number | undefined> = {
  sum: (v) => v.reduce((acc, x) => acc + x, 0),
  product: (v) => v.reduce((acc, x) => acc * x, 1),
  mean: (v) => (v.length > 0 ? v.reduce((acc, x) => acc + x, 0) / v.length : undefined),
  rms: (v) =>
    v.length > 0 ? Math.sqrt(v.reduce((acc, x) => acc + x * x, 0) / v.length) : undefined,
  // reduce instead of spreading: Math.min(...v) throws a RangeError on very large arrays
  min: (v) => (v.length > 0 ? v.reduce((acc, x) => Math.min(acc, x), Infinity) : undefined),
  max: (v) => (v.length > 0 ? v.reduce((acc, x) => Math.max(acc, x), -Infinity) : undefined),
};

// Own-property lookup so user-typed names like `valueOf` or `__proto__` don't hit Object.prototype
function own<T>(table: Record<string, T>, name: string): T | undefined {
  return Object.hasOwn(table, name) ? table[name] : undefined;
}

export const FLOAT64_STRUCTURE: MessagePathStructureItem = {
  structureType: "primitive",
  primitiveType: "float64",
  datatype: "",
};

function messageStructure(datatype: string, names: string[]): MessagePathStructureItemMessage {
  return {
    structureType: "message",
    datatype,
    nextByName: Object.fromEntries(names.map((name) => [name, FLOAT64_STRUCTURE])),
  };
}

const RPY_STRUCTURE = messageStructure("lichtblick.modifier.EulerAngles", ["roll", "pitch", "yaw"]);
const QUATERNION_STRUCTURE = messageStructure("lichtblick.modifier.Quaternion", [
  "x",
  "y",
  "z",
  "w",
]);

function isNumericStructure(item: MessagePathStructureItem | undefined): boolean {
  return (
    item?.structureType === "primitive" &&
    item.primitiveType !== "string" &&
    item.primitiveType !== "bool"
  );
}

function hasNumericFields(item: MessagePathStructureItem, names: string[]): boolean {
  return (
    item.structureType === "message" &&
    names.every((name) => isNumericStructure(item.nextByName[name]))
  );
}

function isNumericArray(item: MessagePathStructureItem): boolean {
  return item.structureType === "array" && isNumericStructure(item.next);
}

/** Result structure of applying a per-element modifier to a number or numeric array. */
function mapNumericStructure(
  input: MessagePathStructureItem,
): MessagePathStructureItem | undefined {
  if (isNumericStructure(input)) {
    return FLOAT64_STRUCTURE;
  }
  return isNumericArray(input)
    ? { structureType: "array", next: FLOAT64_STRUCTURE, datatype: "" }
    : undefined;
}

/**
 * Structure of a modifier's result, mirroring `applyModifier`. Returns undefined for unknown
 * modifiers and for modifiers that do not apply to `input`. An undefined `input` (unknown schema)
 * accepts any known modifier.
 */
export function modifierResultStructure(
  modifier: Pick<MessagePathModifier, "name" | "args">,
  input: MessagePathStructureItem | undefined,
): MessagePathStructureItem | undefined {
  const { name } = modifier;
  const hasArgs = modifier.args.length > 0;
  const isElementWise =
    (own(SCALAR, name) != undefined && !hasArgs) ||
    (own(ARITHMETIC, name) != undefined && (hasArgs || name === "round"));
  const isReducer = own(REDUCERS, name) != undefined;
  if (input == undefined) {
    if (EULER_ORDERS.includes(name)) {
      return RPY_STRUCTURE;
    }
    if (name === "quat") {
      return QUATERNION_STRUCTURE;
    }
    const known = isElementWise || isReducer || ["length", "norm", "magnitude"].includes(name);
    return known ? FLOAT64_STRUCTURE : undefined;
  }
  if (isElementWise) {
    return mapNumericStructure(input);
  }
  if (isReducer) {
    if (!hasArgs) {
      return isNumericArray(input) ? FLOAT64_STRUCTURE : undefined;
    }
    if (input.structureType === "message") {
      return FLOAT64_STRUCTURE;
    }
    return name === "min" || name === "max" ? mapNumericStructure(input) : undefined;
  }
  switch (name) {
    case "length":
      return input.structureType === "array" ? FLOAT64_STRUCTURE : undefined;
    case "norm":
    case "magnitude":
      return isNumericArray(input) || hasNumericFields(input, ["x", "y"]) ? FLOAT64_STRUCTURE : undefined;
    case "rpy":
    case "ypr":
    case "yrp":
      return hasNumericFields(input, ["x", "y", "z", "w"]) ? RPY_STRUCTURE : undefined;
    case "quat":
      return hasNumericFields(input, ["roll", "pitch", "yaw"]) ? QUATERNION_STRUCTURE : undefined;
  }
  return undefined;
}

const SUGGESTIONS = [
  ...Object.keys(SCALAR).filter((name) => name !== "deg2rad" && name !== "rad2deg"),
  "round(2)",
  "add(1)",
  "sub(1)",
  "mul(1)",
  "div(1)",
  "min(0)",
  "max(0)",
  ...Object.keys(REDUCERS),
  "length",
  "norm",
  ...EULER_ORDERS,
  "quat",
];

/** Autocomplete suggestions for a modifier applied to a value with the given structure. */
export function modifierSuggestions(
  input: MessagePathStructureItem | undefined,
  { streamModifiers }: { streamModifiers: boolean },
): string[] {
  const result = SUGGESTIONS.filter((suggestion) => {
    const [name = "", args] = suggestion.split("(");
    if (args != undefined && input?.structureType === "message") {
      // Templates with numeric arguments make no sense for messages
      return false;
    }
    return (
      modifierResultStructure({ name, args: args != undefined ? [0] : [] }, input) != undefined
    );
  });
  if (streamModifiers && (input == undefined || isNumericStructure(input))) {
    result.push(...STREAM_MODIFIERS);
  }
  return result;
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value != undefined && !isArrayLike(value);
}

function isArrayLike(value: unknown): value is ArrayLike<unknown> {
  return Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  return typeof value === "bigint" ? Number(value) : undefined;
}

/** Apply `fn` to a number, or to each element of a numeric array. */
function mapNumeric(value: unknown, fn: (x: number) => number): number | number[] | undefined {
  const num = toNumber(value);
  if (num != undefined) {
    return fn(num);
  }
  if (isArrayLike(value)) {
    return Array.from(value, (x) => fn(toNumber(x) ?? NaN));
  }
  return undefined;
}

function numericArray(value: unknown): number[] | undefined {
  return isArrayLike(value) ? Array.from(value, (x) => toNumber(x) ?? NaN) : undefined;
}

function fields(value: unknown, names: string[]): number[] | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const result: number[] = [];
  for (const name of names) {
    const num = toNumber(value[name]);
    if (num == undefined) {
      return undefined;
    }
    result.push(num);
  }
  return result;
}

function resolveArg(value: unknown, arg: MessagePathModifierArg): number | undefined {
  if (typeof arg === "number") {
    return arg;
  }
  if ("variableName" in arg) {
    // Variables must be filled in before evaluation
    return undefined;
  }
  let current = value;
  for (const name of arg) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[name];
  }
  return toNumber(current);
}

/**
 * Convert a quaternion to roll/pitch/yaw in radians. `rpy` uses intrinsic XYZ, `ypr` ZYX and
 * `yrp` ZXY rotations. At gimbal lock the last axis is reported as 0.
 */
function quaternionToEuler([qx, qy, qz, qw]: number[], order: string): Obj | undefined {
  const length = Math.hypot(qx!, qy!, qz!, qw!);
  if (length === 0) {
    return undefined;
  }
  const [x, y, z, w] = [qx! / length, qy! / length, qz! / length, qw! / length];
  // Rotation matrix elements
  const r00 = 1 - 2 * (y * y + z * z);
  const r01 = 2 * (x * y - z * w);
  const r02 = 2 * (x * z + y * w);
  const r10 = 2 * (x * y + z * w);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - x * w);
  const r20 = 2 * (x * z - y * w);
  const r21 = 2 * (y * z + x * w);
  const r22 = 1 - 2 * (x * x + y * y);
  const clampedAsin = (v: number) => Math.asin(Math.min(1, Math.max(-1, v)));
  const LOCK = 0.9999999;
  switch (order) {
    case "rpy": {
      const pitch = clampedAsin(r02);
      return Math.abs(r02) < LOCK
        ? { roll: Math.atan2(-r12, r22), pitch, yaw: Math.atan2(-r01, r00) }
        : { roll: Math.atan2(r21, r11), pitch, yaw: 0 };
    }
    case "ypr": {
      const pitch = clampedAsin(-r20);
      return Math.abs(r20) < LOCK
        ? { roll: Math.atan2(r21, r22), pitch, yaw: Math.atan2(r10, r00) }
        : { roll: 0, pitch, yaw: Math.atan2(-r01, r11) };
    }
    case "yrp": {
      const roll = clampedAsin(r21);
      return Math.abs(r21) < LOCK
        ? { roll, pitch: Math.atan2(-r20, r22), yaw: Math.atan2(-r01, r11) }
        : { roll, pitch: 0, yaw: Math.atan2(r10, r00) };
    }
  }
  return undefined;
}

/** Inverse of `rpy`: roll/pitch/yaw in radians (intrinsic XYZ) to a quaternion. */
function rpyToQuaternion([roll, pitch, yaw]: number[]): Obj {
  const [c1, s1] = [Math.cos(roll! / 2), Math.sin(roll! / 2)];
  const [c2, s2] = [Math.cos(pitch! / 2), Math.sin(pitch! / 2)];
  const [c3, s3] = [Math.cos(yaw! / 2), Math.sin(yaw! / 2)];
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

function norm(value: unknown): number | undefined {
  const values = numericArray(value) ?? fields(value, ["x", "y", "z"]) ?? fields(value, ["x", "y"]);
  return values && Math.sqrt(values.reduce((acc, x) => acc + x * x, 0));
}

/**
 * Apply a per-message modifier to a value. Returns undefined when the modifier does not apply to
 * the value, so the item is dropped.
 */
export function applyModifier(value: unknown, modifier: MessagePathModifier): unknown {
  const { name } = modifier;
  const args: number[] = [];
  for (const arg of modifier.args) {
    const resolved = resolveArg(value, arg);
    if (resolved == undefined) {
      return undefined;
    }
    args.push(resolved);
  }

  const scalarFn = own(SCALAR, name);
  if (scalarFn && args.length === 0) {
    return mapNumeric(value, scalarFn);
  }
  const arithmeticFn = own(ARITHMETIC, name);
  if (arithmeticFn && (args.length > 0 || name === "round")) {
    return mapNumeric(value, (x) => arithmeticFn(x, args));
  }
  const reducer = own(REDUCERS, name);
  if (reducer) {
    if (args.length === 0) {
      // `/topic.values.@max`: reduce an array within the message
      const values = numericArray(value);
      return values && reducer(values);
    }
    if ((name === "min" || name === "max") && !isObject(value)) {
      // `/topic.value.@max(0)`: clamp element-wise
      return mapNumeric(value, (x) => reducer([x, ...args])!);
    }
    // `/topic.@sum(left, right)`: reduce fields of an object
    return isObject(value) ? reducer(args) : undefined;
  }

  switch (name) {
    case "length":
      return isArrayLike(value) ? value.length : undefined;
    case "norm":
    case "magnitude":
      return norm(value);
    case "rpy":
    case "ypr":
    case "yrp": {
      const quaternion = fields(value, ["x", "y", "z", "w"]);
      return quaternion && quaternionToEuler(quaternion, name);
    }
    case "quat": {
      const rpy = fields(value, ["roll", "pitch", "yaw"]);
      return rpy && rpyToQuaternion(rpy);
    }
  }
  return undefined;
}
