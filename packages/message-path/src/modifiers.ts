// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessagePathModifier, MessagePathModifierArg } from "./types";

/** Modifiers computed across messages. Only valid at the end of a path, see `MessagePath.modifier`. */
export const STREAM_MODIFIERS: readonly string[] = ["derivative", "delta", "timedelta", "integral"];

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
  min: (v) => (v.length > 0 ? Math.min(...v) : undefined),
  max: (v) => (v.length > 0 ? Math.max(...v) : undefined),
};

const ROBOTICS = ["length", "norm", "magnitude", "rpy", "quat"];

export function isKnownModifier(name: string): boolean {
  return name in SCALAR || name in ARITHMETIC || name in REDUCERS || ROBOTICS.includes(name);
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

function quaternionToRpy([x, y, z, w]: number[]): Obj {
  return {
    roll: Math.atan2(2 * (w! * x! + y! * z!), 1 - 2 * (x! * x! + y! * y!)),
    pitch: Math.asin(Math.min(1, Math.max(-1, 2 * (w! * y! - z! * x!)))),
    yaw: Math.atan2(2 * (w! * z! + x! * y!), 1 - 2 * (y! * y! + z! * z!)),
  };
}

function rpyToQuaternion([roll, pitch, yaw]: number[]): Obj {
  const [cr, sr] = [Math.cos(roll! / 2), Math.sin(roll! / 2)];
  const [cp, sp] = [Math.cos(pitch! / 2), Math.sin(pitch! / 2)];
  const [cy, sy] = [Math.cos(yaw! / 2), Math.sin(yaw! / 2)];
  return {
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
    w: cr * cp * cy + sr * sp * sy,
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

  const scalarFn = SCALAR[name];
  if (scalarFn && args.length === 0) {
    return mapNumeric(value, scalarFn);
  }
  const arithmeticFn = ARITHMETIC[name];
  if (arithmeticFn && (args.length > 0 || name === "round")) {
    return mapNumeric(value, (x) => arithmeticFn(x, args));
  }
  const reducer = REDUCERS[name];
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
    case "rpy": {
      const quaternion = fields(value, ["x", "y", "z", "w"]);
      return quaternion && quaternionToRpy(quaternion);
    }
    case "quat": {
      const rpy = fields(value, ["roll", "pitch", "yaw"]);
      return rpy && rpyToQuaternion(rpy);
    }
  }
  return undefined;
}
