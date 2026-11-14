// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageDefinition, MessageDefinitionField } from "@foxglove/message-definition";
import { MessageReader } from "@foxglove/rosmsg2-serialization";

/**
 * ROS 2 CDR decoder that compiles one JavaScript function per schema instead of walking the
 * message definition for every message like `MessageReader` does. Output matches `MessageReader`
 * exactly (same objects, key order, typed-array types and buffer aliasing, `{ sec, nanosec }`
 * times, and it throws where `MessageReader` throws).
 *
 * The generated code inlines nested types into one function, keeps the read offset in a local,
 * and skips alignment math wherever the alignment is already known at compile time.
 *
 * Fails closed: any schema the generator does not handle (unknown types, `wstring`, recursion,
 * unsafe field names, oversized code, or no `new Function`) decodes with `MessageReader`.
 */
export function createRos2CdrDeserializer(
  definitions: MessageDefinition[],
): (data: ArrayBufferView) => unknown {
  const reader = new MessageReader(definitions);
  const fallback = (data: ArrayBufferView): unknown => reader.readMessage(data);

  // Same root and lookup rules as MessageReader.
  const root = definitions.find((def) => !isConstantModule(def));
  if (root == undefined) {
    return fallback;
  }
  const types = new Map(definitions.map((def) => [def.name ?? "", def.definitions]));

  // One compiled variant per (endianness, 8-byte alignment), compiled on first use.
  // `false` marks a schema the generator does not support.
  const variants: (Decoder | false | undefined)[] = [undefined, undefined, undefined, undefined];
  return (data) => {
    if (data.byteLength < 4) {
      return fallback(data); // let MessageReader throw its header error
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const kind = view.getUint8(1);
    const littleEndian = LITTLE_ENDIAN_KINDS.has(kind);
    const isCdr2 = kind > 3;
    const slot = (littleEndian ? 1 : 0) + (isCdr2 ? 2 : 0);
    const decode = (variants[slot] ??= compile(root.definitions, types, {
      littleEndian,
      eightByteAlignment: isCdr2 ? 4 : 8,
    }));
    return decode === false ? fallback(data) : decode(view, RUNTIME);
  };
}

type Decoder = (view: DataView, rt: typeof RUNTIME) => unknown;

// Encapsulation kinds that are little-endian (see @foxglove/cdr getEncapsulationKindInfo).
const LITTLE_ENDIAN_KINDS = new Set([0x01, 0x03, 0x07, 0x09, 0x0b, 0x11, 0x13, 0x15]);
const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const MAX_SOURCE_LENGTH = 512 * 1024;
const SAFE_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isConstantModule(def: MessageDefinition): boolean {
  return def.definitions.length > 0 && def.definitions.every((field) => field.isConstant === true);
}

const textDecoder = new TextDecoder("utf8");

/** Same result as `CdrReader.string()` for `length > 1`; plain ASCII skips TextDecoder. */
function readString(view: DataView, offset: number, length: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length - 1);
  const count = bytes.length;
  if (count > 64) {
    return textDecoder.decode(bytes);
  }
  let ascii = "";
  for (let i = 0; i < count; i++) {
    const byte = bytes[i]!;
    if (byte >= 0x80) {
      return textDecoder.decode(bytes);
    }
    ascii += String.fromCharCode(byte);
  }
  return ascii;
}

const RUNTIME = { readString };

// [DataView getter, byte size, typed array]
const NUMERIC: Record<string, [string, number, string]> = {
  int16: ["getInt16", 2, "Int16Array"],
  uint16: ["getUint16", 2, "Uint16Array"],
  int32: ["getInt32", 4, "Int32Array"],
  uint32: ["getUint32", 4, "Uint32Array"],
  int64: ["getBigInt64", 8, "BigInt64Array"],
  uint64: ["getBigUint64", 8, "BigUint64Array"],
  float32: ["getFloat32", 4, "Float32Array"],
  float64: ["getFloat64", 8, "Float64Array"],
};

class Unsupported extends Error {}

function compile(
  rootFields: MessageDefinitionField[],
  types: Map<string, MessageDefinitionField[]>,
  { littleEndian, eightByteAlignment }: { littleEndian: boolean; eightByteAlignment: 4 | 8 },
): Decoder | false {
  const le = String(littleEndian);
  const lines: string[] = [];
  let size = 0;
  let nextVar = 0;
  // Largest power of two that (offset - 4) is known to be a multiple of; 8 at the start.
  let known = 8;
  const emit = (line: string) => {
    size += line.length + 1;
    if (size > MAX_SOURCE_LENGTH) {
      throw new Unsupported();
    }
    lines.push(line);
  };
  const local = () => `v${nextVar++}`;
  const align = (to: number) => {
    if (known < to) {
      emit(`o += (${to} - ((o - 4) % ${to})) % ${to};`);
      known = to;
    }
  };
  // After advancing by a multiple of `step` bytes (or by 0 bytes).
  const advanced = (step: number) => {
    known = Math.min(known, step);
  };
  const alignmentOf = (byteSize: number) => (byteSize === 8 ? eightByteAlignment : byteSize);
  const readUint32 = (target: string) => {
    align(4);
    emit(`const ${target} = view.getUint32(o, ${le}); o += 4;`);
    advanced(4);
  };

  const readPrimitive = (type: string): string => {
    const v = local();
    switch (type) {
      case "bool":
        emit(`const ${v} = view.getInt8(o) !== 0; o += 1;`);
        advanced(1);
        return v;
      case "int8":
      case "uint8":
        emit(`const ${v} = view.get${type === "int8" ? "Int8" : "Uint8"}(o); o += 1;`);
        advanced(1);
        return v;
      case "string": {
        const n = local();
        readUint32(n);
        emit(`const ${v} = ${n} <= 1 ? "" : rt.readString(view, o, ${n}); o += ${n};`);
        advanced(1);
        return v;
      }
      case "time":
      case "duration": {
        align(4);
        emit(
          `const ${v} = { sec: view.getInt32(o, ${le}), nanosec: view.getUint32(o + 4, ${le}) }; o += 8;`,
        );
        advanced(4);
        return v;
      }
      default: {
        const numeric = NUMERIC[type];
        if (numeric == undefined) {
          throw new Unsupported();
        }
        const [getter, byteSize] = numeric;
        align(alignmentOf(byteSize));
        emit(`const ${v} = view.${getter}(o, ${le}); o += ${byteSize};`);
        advanced(byteSize);
        return v;
      }
    }
  };

  // Emits a loop that runs `body` `count` times; the body starts with unknown alignment.
  const loop = (count: string, body: (i: string) => void) => {
    const i = local();
    emit(`for (let ${i} = 0; ${i} < ${count}; ${i}++) {`);
    known = 1;
    body(i);
    emit(`}`);
    known = 1;
  };

  const readPrimitiveArray = (type: string, fixedLength: number | undefined): string => {
    const v = local();
    let n: string;
    if (fixedLength != undefined) {
      n = String(fixedLength);
    } else {
      n = local();
      readUint32(n);
    }
    if (type === "int8" || type === "uint8") {
      const ctor = type === "int8" ? "Int8Array" : "Uint8Array";
      emit(`const ${v} = new ${ctor}(view.buffer, view.byteOffset + o, ${n}); o += ${n};`);
      advanced(1);
      return v;
    }
    const numeric = NUMERIC[type];
    if (numeric != undefined) {
      // Same results as CdrReader.typedArray(): an empty array without aligning, else a view on
      // the input when the host endianness matches and the data is aligned, else a copy.
      const [getter, byteSize, ctor] = numeric;
      const alignTo = alignmentOf(byteSize);
      const knownBefore = known;
      const sameEndian = littleEndian === HOST_LITTLE_ENDIAN;
      const off = local();
      const i = local();
      emit(`let ${v};`);
      emit(`if (${n} === 0) { ${v} = new ${ctor}(); } else {`);
      align(alignTo);
      emit(`const ${off} = view.byteOffset + o;`);
      if (sameEndian) {
        emit(`if (${off} % ${byteSize} === 0) { ${v} = new ${ctor}(view.buffer, ${off}, ${n}); }`);
        emit(`else if (${n} >= 10) {`);
        emit(`  const copy = new Uint8Array(${n} * ${byteSize});`);
        emit(`  copy.set(new Uint8Array(view.buffer, ${off}, ${n} * ${byteSize}));`);
        emit(`  ${v} = new ${ctor}(copy.buffer, copy.byteOffset, ${n});`);
        emit(`} else {`);
      } else {
        emit(`{`);
      }
      emit(`  ${v} = new ${ctor}(${n});`);
      emit(
        `  for (let ${i} = 0; ${i} < ${n}; ${i}++) { ${v}[${i}] = view.${getter}(o + ${i} * ${byteSize}, ${le}); }`,
      );
      emit(`}`);
      emit(`o += ${n} * ${byteSize}; }`);
      // Empty: offset unchanged. Otherwise aligned to `alignTo`, then whole elements read.
      known = Math.min(knownBefore, alignTo, byteSize);
      return v;
    }
    if (type !== "bool" && type !== "string" && type !== "time" && type !== "duration") {
      throw new Unsupported();
    }
    emit(`const ${v} = new Array(${n});`);
    loop(n, (i) => {
      const item = readPrimitive(type);
      emit(`${v}[${i}] = ${item};`);
    });
    return v;
  };

  const readStruct = (fields: MessageDefinitionField[], stack: Set<MessageDefinitionField[]>) => {
    if (stack.has(fields)) {
      throw new Unsupported(); // recursive type
    }
    const v = local();
    const dataFields = fields.filter((field) => field.isConstant !== true);
    if (dataFields.length === 0) {
      // ROS 2 adds `uint8 structure_needs_at_least_one_member` to empty messages.
      emit(`view.getUint8(o); o += 1;`);
      advanced(1);
      emit(`const ${v} = {};`);
      return v;
    }
    stack.add(fields);
    const entries: string[] = [];
    for (const field of dataFields) {
      if (!SAFE_FIELD_NAME.test(field.name) || field.name === "__proto__") {
        throw new Unsupported();
      }
      let value: string;
      if (field.isComplex === true) {
        const nested = types.get(field.type);
        if (nested == undefined) {
          throw new Unsupported();
        }
        if (field.isArray === true) {
          let n: string;
          if (field.arrayLength != undefined) {
            n = String(field.arrayLength);
          } else {
            n = local();
            readUint32(n);
          }
          value = local();
          emit(`const ${value} = [];`);
          loop(n, () => {
            const item = readStruct(nested, stack);
            emit(`${value}.push(${item});`);
          });
        } else {
          value = readStruct(nested, stack);
        }
      } else if (field.isArray === true) {
        value = readPrimitiveArray(field.type, field.arrayLength);
      } else {
        value = readPrimitive(field.type);
      }
      entries.push(`${field.name}: ${value}`);
    }
    stack.delete(fields);
    emit(`const ${v} = { ${entries.join(", ")} };`);
    return v;
  };

  try {
    emit(`let o = 4;`);
    const result = readStruct(rootFields, new Set());
    emit(`return ${result};`);
    // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
    return new Function("view", "rt", lines.join("\n")) as Decoder;
  } catch (error) {
    if (error instanceof Unsupported || error instanceof EvalError) {
      return false;
    }
    throw error;
  }
}
