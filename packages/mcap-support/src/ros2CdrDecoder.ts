// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageDefinition, MessageDefinitionField } from "@foxglove/message-definition";
import { MessageReader } from "@foxglove/rosmsg2-serialization";

import { Code, CodeBuilder, int, ident, js, Locals, Unsupported } from "./codegen";

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
 * field names that are not plain identifiers, array lengths that are not integers, oversized code,
 * or no `new Function`) decodes with `MessageReader`. Schema text never becomes code: see
 * codegen.ts.
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
const NUMERIC: Record<string, [getter: Code, byteSize: number, ctor: Code]> = {
  int16: [js`getInt16`, 2, js`Int16Array`],
  uint16: [js`getUint16`, 2, js`Uint16Array`],
  int32: [js`getInt32`, 4, js`Int32Array`],
  uint32: [js`getUint32`, 4, js`Uint32Array`],
  int64: [js`getBigInt64`, 8, js`BigInt64Array`],
  uint64: [js`getBigUint64`, 8, js`BigUint64Array`],
  float32: [js`getFloat32`, 4, js`Float32Array`],
  float64: [js`getFloat64`, 8, js`Float64Array`],
};

/**
 * Generates the decoder. All generated text goes through `js`, `ident` and `int` (see
 * codegen.ts), so nothing from the schema can become code.
 */
function compile(
  rootFields: MessageDefinitionField[],
  types: Map<string, MessageDefinitionField[]>,
  { littleEndian, eightByteAlignment }: { littleEndian: boolean; eightByteAlignment: 4 | 8 },
): Decoder | false {
  const le = littleEndian ? js`true` : js`false`;
  const out = new CodeBuilder();
  const emit = (code: Code) => {
    out.emit(code);
  };
  const locals = new Locals();
  const local = () => locals.next();
  // Largest power of two that (offset - 4) is known to be a multiple of; 8 at the start.
  let known = 8;
  const align = (to: number) => {
    if (known < to) {
      const n = int(to);
      emit(js`o += (${n} - ((o - 4) % ${n})) % ${n};`);
      known = to;
    }
  };
  // After advancing by a multiple of `step` bytes (or by 0 bytes).
  const advanced = (step: number) => {
    known = Math.min(known, step);
  };
  const alignmentOf = (byteSize: number) => (byteSize === 8 ? eightByteAlignment : byteSize);
  const readUint32 = (target: Code) => {
    align(4);
    emit(js`const ${target} = view.getUint32(o, ${le}); o += 4;`);
    advanced(4);
  };
  // Fixed array lengths come from the schema, so they must pass `int()`.
  const lengthOf = (field: MessageDefinitionField): Code => {
    if (field.arrayLength != undefined) {
      return int(field.arrayLength);
    }
    const n = local();
    readUint32(n);
    return n;
  };

  const readPrimitive = (type: string): Code => {
    const v = local();
    switch (type) {
      case "bool":
        emit(js`const ${v} = view.getInt8(o) !== 0; o += 1;`);
        advanced(1);
        return v;
      case "int8":
        emit(js`const ${v} = view.getInt8(o); o += 1;`);
        advanced(1);
        return v;
      case "uint8":
        emit(js`const ${v} = view.getUint8(o); o += 1;`);
        advanced(1);
        return v;
      case "string": {
        const n = local();
        readUint32(n);
        emit(js`const ${v} = ${n} <= 1 ? "" : rt.readString(view, o, ${n}); o += ${n};`);
        advanced(1);
        return v;
      }
      case "time":
      case "duration": {
        align(4);
        emit(
          js`const ${v} = { sec: view.getInt32(o, ${le}), nanosec: view.getUint32(o + 4, ${le}) }; o += 8;`,
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
        emit(js`const ${v} = view.${getter}(o, ${le}); o += ${int(byteSize)};`);
        advanced(byteSize);
        return v;
      }
    }
  };

  // Emits a loop that runs `body` `count` times; the body starts with unknown alignment.
  const loop = (count: Code, body: (i: Code) => void) => {
    const i = local();
    emit(js`for (let ${i} = 0; ${i} < ${count}; ${i}++) {`);
    known = 1;
    body(i);
    emit(js`}`);
    known = 1;
  };

  const readPrimitiveArray = (field: MessageDefinitionField): Code => {
    const type = field.type;
    const v = local();
    const n = lengthOf(field);
    if (type === "int8" || type === "uint8") {
      const ctor = type === "int8" ? js`Int8Array` : js`Uint8Array`;
      emit(js`const ${v} = new ${ctor}(view.buffer, view.byteOffset + o, ${n}); o += ${n};`);
      advanced(1);
      return v;
    }
    const numeric = NUMERIC[type];
    if (numeric != undefined) {
      // Same results as CdrReader.typedArray(): an empty array without aligning, else a view on
      // the input when the host endianness matches and the data is aligned, else a copy.
      const [getter, byteSize, ctor] = numeric;
      const size = int(byteSize);
      const alignTo = alignmentOf(byteSize);
      const knownBefore = known;
      const off = local();
      const i = local();
      emit(js`let ${v};`);
      emit(js`if (${n} === 0) { ${v} = new ${ctor}(); } else {`);
      align(alignTo);
      emit(js`const ${off} = view.byteOffset + o;`);
      if (littleEndian === HOST_LITTLE_ENDIAN) {
        emit(js`if (${off} % ${size} === 0) { ${v} = new ${ctor}(view.buffer, ${off}, ${n}); }`);
        emit(js`else if (${n} >= 10) {`);
        emit(js`  const copy = new Uint8Array(${n} * ${size});`);
        emit(js`  copy.set(new Uint8Array(view.buffer, ${off}, ${n} * ${size}));`);
        emit(js`  ${v} = new ${ctor}(copy.buffer, copy.byteOffset, ${n});`);
        emit(js`} else {`);
      } else {
        emit(js`{`);
      }
      emit(js`  ${v} = new ${ctor}(${n});`);
      emit(
        js`  for (let ${i} = 0; ${i} < ${n}; ${i}++) { ${v}[${i}] = view.${getter}(o + ${i} * ${size}, ${le}); }`,
      );
      emit(js`}`);
      emit(js`o += ${n} * ${size}; }`);
      // Empty: offset unchanged. Otherwise aligned to `alignTo`, then whole elements read.
      known = Math.min(knownBefore, alignTo, byteSize);
      return v;
    }
    if (type !== "bool" && type !== "string" && type !== "time" && type !== "duration") {
      throw new Unsupported();
    }
    emit(js`const ${v} = new Array(${n});`);
    loop(n, (i) => {
      const item = readPrimitive(type);
      emit(js`${v}[${i}] = ${item};`);
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
      emit(js`view.getUint8(o); o += 1;`);
      advanced(1);
      emit(js`const ${v} = {};`);
      return v;
    }
    stack.add(fields);
    let entries: Code | undefined;
    for (const field of dataFields) {
      const name = ident(field.name);
      let value: Code;
      if (field.isComplex === true) {
        const nested = types.get(field.type);
        if (nested == undefined) {
          throw new Unsupported();
        }
        if (field.isArray === true) {
          const n = lengthOf(field);
          const array = local();
          emit(js`const ${array} = [];`);
          loop(n, () => {
            const item = readStruct(nested, stack);
            emit(js`${array}.push(${item});`);
          });
          value = array;
        } else {
          value = readStruct(nested, stack);
        }
      } else if (field.isArray === true) {
        value = readPrimitiveArray(field);
      } else {
        value = readPrimitive(field.type);
      }
      entries = entries == undefined ? js`${name}: ${value}` : js`${entries}, ${name}: ${value}`;
    }
    stack.delete(fields);
    emit(js`const ${v} = { ${entries!} };`);
    return v;
  };

  try {
    emit(js`let o = 4;`);
    const result = readStruct(rootFields, new Set());
    emit(js`return ${result};`);
    return out.compile<Decoder>(js`view`, js`rt`) ?? false;
  } catch (error) {
    if (error instanceof Unsupported) {
      return false;
    }
    throw error;
  }
}
