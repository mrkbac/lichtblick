// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { CdrWriter, EncapsulationKind } from "@foxglove/cdr";
import { MessageDefinition, MessageDefinitionField } from "@foxglove/message-definition";
import { MessageReader, MessageWriter } from "@foxglove/rosmsg2-serialization";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRos2CdrDeserializer } from "./ros2CdrDecoder";

// Small deterministic PRNG so failures reproduce.
function makeRng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(next() * max);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)]!;
  return { next, int, pick };
}
type Rng = ReturnType<typeof makeRng>;

const PRIMITIVES = [
  "bool",
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "int64",
  "uint64",
  "float32",
  "float64",
  "string",
  "time",
  "duration",
] as const;

// Array element types that decode into plain arrays, which never allocate up front.
const UNBOXED = new Set(["bool", "string", "time", "duration"]);

const STRINGS = ["", "a", "frame", "ünïcødé ✓", "x".repeat(70), "tab\tnul\0end", "﻿bom"];

/** Random schema: definitions[0] is the root; nested types only reference later ones. */
function randomSchema(rng: Rng): MessageDefinition[] {
  const typeCount = 1 + rng.int(4);
  const names = Array.from({ length: typeCount }, (_, i) => `pkg/msg/T${i}`);
  return names.map((name, index) => {
    const fieldCount = rng.next() < 0.08 ? 0 : 1 + rng.int(7);
    const definitions: MessageDefinitionField[] = [];
    for (let i = 0; i < fieldCount; i++) {
      // Keep the root from being all constants (MessageReader would skip it as a constant module).
      if (rng.next() < 0.1 && !(index === 0 && i === 0)) {
        definitions.push({ name: `C${i}`, type: "int32", isConstant: true, value: 3 });
        continue;
      }
      const complex = index + 1 < typeCount && rng.next() < 0.3;
      const field: MessageDefinitionField = {
        name: `f${i}`,
        type: complex ? names[index + 1 + rng.int(typeCount - index - 1)]! : rng.pick(PRIMITIVES),
        isComplex: complex,
      };
      const arrayKind = rng.int(4);
      if (arrayKind === 1) {
        field.isArray = true;
      } else if (arrayKind === 2) {
        field.isArray = true;
        field.arrayLength = rng.int(13);
      } else if (arrayKind === 3) {
        field.isArray = true;
        field.arrayUpperBound = 20; // bounded sequences are read like unbounded ones
      }
      definitions.push(field);
    }
    return { name: index === 0 ? undefined : name, definitions };
  });
}

function randomPrimitive(rng: Rng, type: string): unknown {
  switch (type) {
    case "bool":
      return rng.next() < 0.5;
    case "int8":
      return rng.int(256) - 128;
    case "uint8":
      return rng.int(256);
    case "int16":
      return rng.int(65536) - 32768;
    case "uint16":
      return rng.int(65536);
    case "int32":
      return rng.int(2 ** 32) - 2 ** 31;
    case "uint32":
      return rng.int(2 ** 32);
    case "int64":
      return BigInt(rng.int(2 ** 32) - 2 ** 31) * BigInt(rng.int(2 ** 31) + 1);
    case "uint64":
      return BigInt(rng.int(2 ** 32)) * BigInt(rng.int(2 ** 32));
    case "float32":
      return Math.fround((rng.next() - 0.5) * 1e6);
    case "float64":
      return rng.pick([0, -0, NaN, Infinity, (rng.next() - 0.5) * 1e12]);
    case "string":
      return rng.pick(STRINGS);
    case "time":
    case "duration":
      return { sec: rng.int(2 ** 31), nanosec: rng.int(1e9) };
  }
  throw new Error(`unexpected ${type}`);
}

function randomValue(
  rng: Rng,
  fields: MessageDefinitionField[],
  types: Map<string, MessageDefinitionField[]>,
): Record<string, unknown> {
  const msg: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.isConstant === true) {
      continue;
    }
    const one = () =>
      field.isComplex === true
        ? randomValue(rng, types.get(field.type)!, types)
        : randomPrimitive(rng, field.type);
    if (field.isArray === true) {
      // Lengths around 10 hit both the per-element and the copy path for unaligned data.
      const length = field.arrayLength ?? rng.pick([0, 1, 3, 9, 10, 17]);
      msg[field.name] = Array.from({ length }, one);
    } else {
      msg[field.name] = one();
    }
  }
  return msg;
}

/** Writes `value` with any encapsulation kind (MessageWriter only writes CDR_LE). */
function writeWithKind(
  kind: EncapsulationKind,
  fields: MessageDefinitionField[],
  types: Map<string, MessageDefinitionField[]>,
  value: Record<string, unknown>,
): Uint8Array {
  const writer = new CdrWriter({ kind });
  const writePrimitive = (type: string, item: unknown) => {
    switch (type) {
      case "bool":
        writer.int8(item === true ? 1 : 0);
        break;
      case "string":
        writer.string(item as string);
        break;
      case "time":
      case "duration": {
        const time = item as { sec: number; nanosec: number };
        writer.int32(time.sec);
        writer.uint32(time.nanosec);
        break;
      }
      default:
        (writer[type as "int32"] as (value: unknown) => void).call(writer, item);
    }
  };
  const writeStruct = (structFields: MessageDefinitionField[], msg: Record<string, unknown>) => {
    const dataFields = structFields.filter((field) => field.isConstant !== true);
    if (dataFields.length === 0) {
      writer.uint8(0);
      return;
    }
    for (const field of dataFields) {
      const item = msg[field.name];
      const writeOne = (one: unknown) => {
        if (field.isComplex === true) {
          writeStruct(types.get(field.type)!, one as Record<string, unknown>);
        } else {
          writePrimitive(field.type, one);
        }
      };
      if (field.isArray === true) {
        const items = item as unknown[];
        if (field.arrayLength == undefined) {
          writer.sequenceLength(items.length);
        }
        // CdrReader skips alignment for empty numeric arrays; skip it here too.
        items.forEach(writeOne);
      } else {
        writeOne(item);
      }
    }
  };
  writeStruct(fields, value);
  return writer.data;
}

/** Serializes a decoded value including key order, typed-array types and buffer aliasing. */
function canonical(value: unknown, input: ArrayBufferLike): unknown {
  if (typeof value === "bigint") {
    return `bigint:${value}`;
  }
  if (typeof value === "number") {
    return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
  }
  if (ArrayBuffer.isView(value)) {
    const typed = value as unknown as ArrayLike<number | bigint>;
    return {
      type: value.constructor.name,
      values: Array.from(typed, (item) => canonical(item, input)),
      aliasesInput: value.buffer === input,
      byteOffset: value.buffer === input ? value.byteOffset : undefined,
    };
  }
  if (Array.isArray(value)) {
    return { array: value.map((item) => canonical(item, input)), length: value.length };
  }
  if (value != undefined && typeof value === "object") {
    return Object.entries(value).map(([key, item]) => [key, canonical(item, input)]);
  }
  return value;
}

function decodeBoth(definitions: MessageDefinition[], data: Uint8Array) {
  const run = (decode: (view: ArrayBufferView) => unknown) => {
    try {
      return { value: canonical(decode(data), data.buffer) };
    } catch (error) {
      return { error: (error as Error).name };
    }
  };
  const reader = new MessageReader(definitions);
  const expected = run((view) => reader.readMessage(view));
  const actual = run(createRos2CdrDeserializer(definitions));
  return { expected, actual };
}

/** Copies `bytes` into a larger buffer at `offset`, with `tail` extra bytes after the view. */
function placeAt(bytes: Uint8Array, offset: number, tail = 0): Uint8Array {
  const buffer = new ArrayBuffer(offset + bytes.byteLength + tail);
  const view = new Uint8Array(buffer, offset, bytes.byteLength);
  view.set(bytes);
  return view;
}

const KINDS = [
  EncapsulationKind.CDR_LE,
  EncapsulationKind.CDR_BE,
  EncapsulationKind.CDR2_LE,
  EncapsulationKind.CDR2_BE,
  EncapsulationKind.RTPS_CDR2_LE,
];

describe("createRos2CdrDeserializer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("decodes random schemas exactly like MessageReader", () => {
    const fallbackSpy = vi.spyOn(MessageReader.prototype, "readMessage");
    let compared = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const rng = makeRng(seed);
      const definitions = randomSchema(rng);
      const types = new Map(definitions.map((def) => [def.name ?? "", def.definitions]));
      const root = definitions[0]!.definitions;
      const value = randomValue(rng, root, types);

      const written = new MessageWriter(definitions).writeMessage(value);
      expect(writeWithKind(EncapsulationKind.CDR_LE, root, types, value)).toEqual(written);

      const inputs = [written, ...KINDS.map((kind) => writeWithKind(kind, root, types, value))];
      for (const bytes of inputs) {
        for (const data of [placeAt(bytes, 0), placeAt(bytes, 1 + rng.int(7), 16)]) {
          fallbackSpy.mockClear();
          const actual = createRos2CdrDeserializer(definitions)(data);
          expect(fallbackSpy).not.toHaveBeenCalled(); // the generated code ran
          const reader = new MessageReader(definitions);
          expect(canonical(actual, data.buffer), `seed ${seed}`).toEqual(
            canonical(reader.readMessage(data), data.buffer),
          );
          compared++;
        }
        // Truncated input: both throw, or both return the same value.
        const cut = placeAt(bytes.subarray(0, 4 + rng.int(bytes.byteLength - 3)), 0);
        const { expected, actual } = decodeBoth(definitions, cut);
        expect(actual, `seed ${seed} truncated`).toEqual(expected);
      }
    }
    expect(compared).toBe(400 * (KINDS.length + 1) * 2);
  });

  it("decodes random bytes like MessageReader", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rng = makeRng(seed);
      // Garbage sequence lengths make both decoders allocate typed arrays of up to 32 GB, so
      // numeric arrays get a fixed length here (the test above covers dynamic ones).
      const definitions = randomSchema(rng).map((def) => ({
        ...def,
        definitions: def.definitions.map((field) =>
          field.isArray === true && field.isComplex !== true && !UNBOXED.has(field.type)
            ? { ...field, arrayLength: field.arrayLength ?? rng.int(13) }
            : field,
        ),
      }));
      const bytes = new Uint8Array(4 + rng.int(64));
      for (let i = 4; i < bytes.length; i++) {
        // Mostly small values so sequence lengths stay small.
        bytes[i] = rng.next() < 0.7 ? rng.int(4) : rng.int(256);
      }
      bytes[1] = rng.pick(KINDS);
      const { expected, actual } = decodeBoth(definitions, placeAt(bytes, rng.int(8), 8));
      expect(actual, `seed ${seed}`).toEqual(expected);
    }
  });

  it("decodes a time primitive as sec/nanosec", () => {
    const definitions: MessageDefinition[] = [
      {
        definitions: [
          { name: "stamp", type: "time" },
          { name: "d", type: "duration" },
        ],
      },
    ];
    const data = new MessageWriter(definitions).writeMessage({
      stamp: { sec: 1, nanosec: 2 },
      d: { sec: 3, nanosec: 4 },
    });
    expect(createRos2CdrDeserializer(definitions)(data)).toEqual({
      stamp: { sec: 1, nanosec: 2 },
      d: { sec: 3, nanosec: 4 },
    });
  });

  it("falls back to MessageReader for schemas it does not compile", () => {
    const schemas: MessageDefinition[][] = [
      [{ definitions: [{ name: "w", type: "wstring" }] }],
      [{ definitions: [{ name: "x", type: "pkg/Missing", isComplex: true, isArray: true }] }],
      [
        { definitions: [{ name: "n", type: "pkg/Node", isComplex: true, isArray: true }] },
        {
          name: "pkg/Node",
          definitions: [{ name: "children", type: "pkg/Node", isComplex: true, isArray: true }],
        },
      ],
      [{ definitions: [{ name: "__proto__", type: "uint8" }] }],
      [{ definitions: [{ name: "has-dash", type: "uint8" }] }],
    ];
    const data = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    for (const definitions of schemas) {
      const spy = vi.spyOn(MessageReader.prototype, "readMessage");
      const { expected, actual } = decodeBoth(definitions, data);
      expect(actual).toEqual(expected);
      expect(spy).toHaveBeenCalledTimes(2); // once for the reference, once as fallback
      spy.mockRestore();
    }
  });

  it("throws the header error for data shorter than 4 bytes", () => {
    const definitions: MessageDefinition[] = [{ definitions: [{ name: "a", type: "uint8" }] }];
    expect(() => createRos2CdrDeserializer(definitions)(new Uint8Array(2))).toThrow(
      "Invalid CDR data size",
    );
  });
});
