// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageDefinitionField } from "@foxglove/message-definition";

import type { ParsedChannel } from "./parseChannel";
import { readString } from "./ros2CdrDecoder";
import { MessageDefinitionMap } from "./types";

/**
 * Cap'n Proto support for the MCAP `capnproto` encoding: the schema is a binary
 * CodeGeneratorRequest (`capnp compile -o -`), messages are single stream-framed, unpacked
 * messages. https://capnproto.org/encoding.html
 *
 * Each struct gets one decoder built from closures with all offsets, defaults and element sizes
 * resolved up front, so decoding a message is pointer chasing plus DataView reads. Numeric lists
 * become typed arrays (one memcpy), Data becomes a Uint8Array copy, so decoded messages never pin
 * the source buffer.
 *
 * Interfaces and AnyPointer (including generic parameters) are skipped: there is nothing to
 * show for a capability, and an untyped pointer cannot be decoded without its type.
 */

// ---------------------------------------------------------------------------------------------
// Wire format reader

/** A struct's location: absolute byte offsets into the message. */
type StructRef = { data: number; dataBytes: number; ptrs: number; ptrCount: number };

const EMPTY_STRUCT: StructRef = { data: 0, dataBytes: 0, ptrs: 0, ptrCount: 0 };

class Message {
  public readonly view: DataView;
  public readonly bytes: Uint8Array;
  readonly #segmentStarts: number[] = [];
  #budget: number;

  // Results of `#follow`: the pointer word describing the target, and the target itself.
  #tag = 0;
  #target = 0;

  public constructor(data: ArrayBufferView) {
    this.bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const segmentCount = this.view.getUint32(0, true) + 1;
    // Header: count, sizes, padded to a word.
    let start = (4 + segmentCount * 4 + 7) & ~7;
    for (let i = 0; i < segmentCount; i++) {
      this.#segmentStarts.push(start);
      start += this.view.getUint32(4 + i * 4, true) * 8;
    }
    if (start > data.byteLength) {
      throw new Error(`Cap'n Proto message truncated: ${data.byteLength} of ${start} bytes`);
    }
    // Every word is read at most once in a well-formed message; the slack only matters for
    // malicious ones that point many pointers at the same data (amplification).
    this.#budget = (data.byteLength / 8) * 8 + 1024;
  }

  public root(): StructRef {
    return this.struct(this.#segmentStarts[0]!);
  }

  #charge(words: number): void {
    this.#budget -= words;
    if (this.#budget < 0) {
      throw new Error("Cap'n Proto message exceeds the traversal limit");
    }
  }

  /** Resolve the pointer at byte `p` (following far pointers). Returns false for null. */
  #follow(p: number): boolean {
    const view = this.view;
    const lo = view.getUint32(p, true);
    const hi = view.getUint32(p + 4, true);
    if (lo === 0 && hi === 0) {
      return false;
    }
    if ((lo & 3) !== 2) {
      this.#tag = p;
      this.#target = p + 8 + (lo >> 2) * 8;
      return true;
    }
    const pad = this.#segment(hi) + (lo >>> 3) * 8;
    if ((lo & 4) === 0) {
      this.#tag = pad;
      this.#target = pad + 8 + (view.getUint32(pad, true) >> 2) * 8;
    } else {
      // Double-far: the pad is a far pointer to the content plus a tag word.
      this.#tag = pad + 8;
      this.#target =
        this.#segment(view.getUint32(pad + 4, true)) + (view.getUint32(pad, true) >>> 3) * 8;
    }
    return true;
  }

  #segment(id: number): number {
    const start = this.#segmentStarts[id];
    if (start == undefined) {
      throw new Error(`Cap'n Proto far pointer to missing segment ${id}`);
    }
    return start;
  }

  /** The struct at pointer `p`, or the empty struct (all defaults) for a null pointer. */
  public struct(p: number): StructRef {
    if (!this.#follow(p)) {
      return EMPTY_STRUCT;
    }
    const tagLo = this.view.getUint32(this.#tag, true);
    if ((tagLo & 3) !== 0) {
      throw new Error("Cap'n Proto pointer is not a struct pointer");
    }
    const hi = this.view.getUint32(this.#tag + 4, true);
    const dataWords = hi & 0xffff;
    const ptrCount = hi >>> 16;
    this.#charge(dataWords + ptrCount);
    const data = this.#target;
    return { data, dataBytes: dataWords * 8, ptrs: data + dataWords * 8, ptrCount };
  }

  // List results, valid until the next `list` call.
  public elementSize = 0;
  public count = 0;
  public start = 0;
  /** For struct lists (any element size): stride and per-element section sizes in bytes. */
  public stride = 0;
  public elementDataBytes = 0;
  public elementPtrCount = 0;

  /** Locate the list at pointer `p`. Returns false for null (an empty list). */
  public list(p: number): boolean {
    if (!this.#follow(p)) {
      return false;
    }
    const view = this.view;
    if ((view.getUint32(this.#tag, true) & 3) !== 1) {
      throw new Error("Cap'n Proto pointer is not a list pointer");
    }
    const hi = view.getUint32(this.#tag + 4, true);
    const elementSize = hi & 7;
    this.elementSize = elementSize;
    this.elementPtrCount = elementSize === 6 ? 1 : 0;
    if (elementSize === 7) {
      // Composite: a tag word (struct-pointer shaped, offset = element count) precedes the data.
      const tagLo = view.getUint32(this.#target, true);
      const tagHi = view.getUint32(this.#target + 4, true);
      this.count = tagLo >>> 2;
      this.start = this.#target + 8;
      this.elementDataBytes = (tagHi & 0xffff) * 8;
      this.elementPtrCount = tagHi >>> 16;
      this.stride = this.elementDataBytes + this.elementPtrCount * 8;
      // Zero-size elements still cost one each, or a tiny list could claim billions of them.
      this.#charge((hi >>> 3) + 1 + (this.stride === 0 ? this.count : 0));
    } else {
      this.count = hi >>> 3;
      this.start = this.#target;
      this.stride = ELEMENT_BYTES[elementSize]!;
      this.elementDataBytes = elementSize === 6 ? 0 : this.stride;
      this.#charge(
        elementSize === 0
          ? this.count
          : Math.ceil((this.count * (elementSize === 1 ? 1 : this.stride * 8)) / 64),
      );
    }
    // Catches corrupt counts before allocating output for them.
    if (
      this.start + Math.ceil((this.count * (elementSize === 1 ? 1 : this.stride * 8)) / 8) >
      view.byteLength
    ) {
      throw new Error("Cap'n Proto list extends past the end of the message");
    }
    return true;
  }

  public text(p: number): string | undefined {
    if (!this.list(p)) {
      return undefined;
    }
    if (this.elementSize !== 2) {
      throw new Error("Cap'n Proto Text is not a byte list");
    }
    // Drop the NUL terminator.
    return this.count <= 1 ? "" : readString(this.bytes, this.start, this.count - 1);
  }

  public data(p: number): Uint8Array | undefined {
    if (!this.list(p)) {
      return undefined;
    }
    if (this.elementSize !== 2) {
      throw new Error("Cap'n Proto Data is not a byte list");
    }
    return this.bytes.slice(this.start, this.start + this.count);
  }
}

// Bytes per element by list element size code; bit lists are handled separately.
const ELEMENT_BYTES = [0, 0, 1, 2, 4, 8, 8, 0];

// ---------------------------------------------------------------------------------------------
// Schema (CodeGeneratorRequest) reader. Offsets are from schema.capnp.

type TypeInfo =
  | { kind: "void" | "bool" | "text" | "data" | "interface" | "anyPointer" }
  | { kind: Primitive }
  | { kind: "list"; element: TypeInfo }
  | { kind: "enum" | "struct"; typeId: bigint };

type Primitive =
  | "int8"
  | "int16"
  | "int32"
  | "int64"
  | "uint8"
  | "uint16"
  | "uint32"
  | "uint64"
  | "float32"
  | "float64";

const TYPE_KINDS = [
  "void",
  "bool",
  "int8",
  "int16",
  "int32",
  "int64",
  "uint8",
  "uint16",
  "uint32",
  "uint64",
  "float32",
  "float64",
  "text",
  "data",
  "list",
  "enum",
  "struct",
  "interface",
  "anyPointer",
] as const;

type FieldInfo = {
  name: string;
  /** 0xffff when the field is not in the struct's union. */
  discriminantValue: number;
} & (
  | {
      which: "slot";
      offset: number;
      type: TypeInfo;
      /** Default value as raw bits (numbers, bools, enums), or the default text. */
      defaultBits: bigint;
      defaultText?: string;
    }
  | { which: "group"; typeId: bigint }
);

type NodeInfo = {
  id: bigint;
  displayName: string;
} & (
  | {
      which: "struct";
      isGroup: boolean;
      discriminantCount: number;
      discriminantOffset: number;
      fields: FieldInfo[];
    }
  | { which: "enum"; enumerants: string[] }
  | { which: "other" }
);

function u16(msg: Message, s: StructRef, byte: number): number {
  return byte + 2 <= s.dataBytes ? msg.view.getUint16(s.data + byte, true) : 0;
}

function u32(msg: Message, s: StructRef, byte: number): number {
  return byte + 4 <= s.dataBytes ? msg.view.getUint32(s.data + byte, true) : 0;
}

function u64(msg: Message, s: StructRef, byte: number): bigint {
  return byte + 8 <= s.dataBytes ? msg.view.getBigUint64(s.data + byte, true) : 0n;
}

function bit(msg: Message, s: StructRef, offset: number): boolean {
  const byte = offset >>> 3;
  return byte < s.dataBytes && ((msg.view.getUint8(s.data + byte) >> (offset & 7)) & 1) === 1;
}

function ptr(s: StructRef, index: number): number | undefined {
  return index < s.ptrCount ? s.ptrs + index * 8 : undefined;
}

function readStructList<T>(msg: Message, p: number | undefined, read: (s: StructRef) => T): T[] {
  if (p == undefined || !msg.list(p)) {
    return [];
  }
  const { count, start, stride, elementDataBytes, elementPtrCount } = msg;
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    const data = start + i * stride;
    out.push(
      read({
        data,
        dataBytes: elementDataBytes,
        ptrs: data + elementDataBytes,
        ptrCount: elementPtrCount,
      }),
    );
  }
  return out;
}

function readText(msg: Message, p: number | undefined): string {
  return p == undefined ? "" : (msg.text(p) ?? "");
}

function readType(msg: Message, s: StructRef): TypeInfo {
  const kind = TYPE_KINDS[u16(msg, s, 0)];
  switch (kind) {
    case undefined:
      return { kind: "anyPointer" }; // a newer type kind: skip it
    case "list": {
      const elementPtr = ptr(s, 0);
      return {
        kind,
        element: elementPtr == undefined ? { kind: "void" } : readType(msg, msg.struct(elementPtr)),
      };
    }
    case "enum":
    case "struct":
      return { kind, typeId: u64(msg, s, 8) };
    default:
      return { kind };
  }
}

/** A Value's raw bits, laid out like the field it is the default of (so it XORs directly). */
function readDefault(msg: Message, s: StructRef, type: TypeInfo): { bits: bigint; text?: string } {
  switch (type.kind) {
    case "bool":
      return { bits: bit(msg, s, 16) ? 1n : 0n };
    case "int8":
    case "uint8":
      return { bits: BigInt(s.dataBytes > 2 ? msg.view.getUint8(s.data + 2) : 0) };
    case "int16":
    case "uint16":
    case "enum":
      return { bits: BigInt(u16(msg, s, 2)) };
    case "int32":
    case "uint32":
    case "float32":
      return { bits: BigInt(u32(msg, s, 4)) };
    case "int64":
    case "uint64":
    case "float64":
      return { bits: u64(msg, s, 8) };
    case "text": {
      const p = ptr(s, 0);
      return { bits: 0n, text: p == undefined ? undefined : msg.text(p) };
    }
    default:
      return { bits: 0n };
  }
}

function readField(msg: Message, s: StructRef): FieldInfo {
  const name = readText(msg, ptr(s, 0));
  // discriminantValue defaults to 0xffff, so it is stored XORed with it.
  const discriminantValue = u16(msg, s, 2) ^ 0xffff;
  if (u16(msg, s, 8) === 1) {
    return { name, discriminantValue, which: "group", typeId: u64(msg, s, 16) };
  }
  const typePtr = ptr(s, 2);
  const type: TypeInfo =
    typePtr == undefined ? { kind: "void" } : readType(msg, msg.struct(typePtr));
  const defaultPtr = ptr(s, 3);
  const def =
    defaultPtr == undefined ? { bits: 0n } : readDefault(msg, msg.struct(defaultPtr), type);
  return {
    name,
    discriminantValue,
    which: "slot",
    offset: u32(msg, s, 4),
    type,
    defaultBits: def.bits,
    defaultText: def.text,
  };
}

function readNode(msg: Message, s: StructRef): NodeInfo {
  const id = u64(msg, s, 0);
  const displayName = readText(msg, ptr(s, 0));
  switch (u16(msg, s, 12)) {
    case 1:
      return {
        id,
        displayName,
        which: "struct",
        isGroup: bit(msg, s, 224),
        discriminantCount: u16(msg, s, 30),
        discriminantOffset: u32(msg, s, 32),
        fields: readStructList(msg, ptr(s, 3), (f) => readField(msg, f)),
      };
    case 2:
      return {
        id,
        displayName,
        which: "enum",
        enumerants: readStructList(msg, ptr(s, 3), (e) => readText(msg, ptr(e, 0))),
      };
    default:
      return { id, displayName, which: "other" };
  }
}

// ---------------------------------------------------------------------------------------------
// Decoder compiler

type Reader = (msg: Message, s: StructRef) => unknown;
type PointerReader = (msg: Message, p: number) => unknown;

const scratch = new DataView(new ArrayBuffer(8));

function primitiveReader(kind: Primitive, offset: number, defaultBits: bigint): Reader {
  const size = kind.endsWith("64") ? 8 : kind.endsWith("32") ? 4 : kind.endsWith("16") ? 2 : 1;
  const byte = offset * size;
  const end = byte + size;
  if (size === 8) {
    if (kind === "float64") {
      if (defaultBits === 0n) {
        return (msg, s) => (end <= s.dataBytes ? msg.view.getFloat64(s.data + byte, true) : 0);
      }
      return (msg, s) => {
        scratch.setBigUint64(
          0,
          (end <= s.dataBytes ? msg.view.getBigUint64(s.data + byte, true) : 0n) ^ defaultBits,
          true,
        );
        return scratch.getFloat64(0, true);
      };
    }
    const signed = kind === "int64";
    return (msg, s) => {
      const bits =
        (end <= s.dataBytes ? msg.view.getBigUint64(s.data + byte, true) : 0n) ^ defaultBits;
      return signed ? BigInt.asIntN(64, bits) : bits;
    };
  }
  const def = Number(defaultBits);
  if (kind === "float32") {
    if (def === 0) {
      return (msg, s) => (end <= s.dataBytes ? msg.view.getFloat32(s.data + byte, true) : 0);
    }
    return (msg, s) => {
      scratch.setUint32(
        0,
        ((end <= s.dataBytes ? msg.view.getUint32(s.data + byte, true) : 0) ^ def) >>> 0,
        true,
      );
      return scratch.getFloat32(0, true);
    };
  }
  // Integers: XOR the raw bits, then reinterpret with the right signedness and width.
  const get =
    size === 4
      ? (v: DataView, o: number) => v.getUint32(o, true)
      : size === 2
        ? (v: DataView, o: number) => v.getUint16(o, true)
        : (v: DataView, o: number) => v.getUint8(o);
  const shift = 32 - size * 8;
  const signed = kind.startsWith("int");
  return (msg, s) => {
    const raw = (end <= s.dataBytes ? get(msg.view, s.data + byte) : 0) ^ def;
    return signed
      ? (raw << shift) >> shift
      : shift === 0
        ? raw >>> 0
        : raw & ((1 << (size * 8)) - 1);
  };
}

const TYPED_ARRAYS = {
  int8: Int8Array,
  uint8: Uint8Array,
  int16: Int16Array,
  uint16: Uint16Array,
  int32: Int32Array,
  uint32: Uint32Array,
  int64: BigInt64Array,
  uint64: BigUint64Array,
  float32: Float32Array,
  float64: Float64Array,
} as const;

// Capnp is little-endian; typed arrays use the host's order.
const LITTLE_ENDIAN_HOST = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

class Compiler {
  readonly #nodes: Map<bigint, NodeInfo>;
  readonly #structReaders = new Map<bigint, Reader>();
  public readonly datatypes: MessageDefinitionMap = new Map();

  public constructor(nodes: Map<bigint, NodeInfo>) {
    this.#nodes = nodes;
  }

  #node(id: bigint): NodeInfo {
    const node = this.#nodes.get(id);
    if (node == undefined) {
      throw new Error(`Cap'n Proto schema is missing node 0x${id.toString(16)}`);
    }
    return node;
  }

  /** Decoder for a struct node. Recursive references get a forwarder to the finished one. */
  public struct(id: bigint): Reader {
    const existing = this.#structReaders.get(id);
    if (existing) {
      return existing;
    }
    const slot: { read?: Reader } = {};
    this.#structReaders.set(id, (msg, s) => slot.read!(msg, s));
    const compiled = this.#compileStruct(id);
    slot.read = compiled;
    this.#structReaders.set(id, compiled);
    return compiled;
  }

  #compileStruct(id: bigint): Reader {
    const node = this.#node(id);
    if (node.which !== "struct") {
      throw new Error(`Cap'n Proto node ${node.displayName} is not a struct`);
    }
    const definitions: MessageDefinitionField[] = [];
    this.datatypes.set(node.displayName, { name: node.displayName, definitions });

    const always: { name: string; read: Reader }[] = [];
    const unionMembers = new Map<number, { name: string; read: Reader | undefined }>();
    for (const field of node.fields) {
      const read = this.#field(field, definitions);
      if (field.discriminantValue !== 0xffff) {
        unionMembers.set(field.discriminantValue, { name: field.name, read });
      } else if (read) {
        always.push({ name: field.name, read });
      }
    }
    const discriminantByte = node.discriminantOffset * 2;
    const hasUnion = node.discriminantCount > 0;
    return (msg, s) => {
      const out: Record<string, unknown> = {};
      for (const { name, read } of always) {
        out[name] = read(msg, s);
      }
      if (hasUnion) {
        // Only the active member is present; a Void member is present as null.
        const member = unionMembers.get(u16(msg, s, discriminantByte));
        if (member) {
          out[member.name] = member.read ? member.read(msg, s) : null;
        }
      }
      return out;
    };
  }

  /** The field's reader (undefined for fields with nothing to show), adding its datatype. */
  #field(field: FieldInfo, definitions: MessageDefinitionField[]): Reader | undefined {
    if (field.which === "group") {
      const group = this.#node(field.typeId);
      definitions.push({ name: field.name, type: group.displayName, isComplex: true });
      return this.struct(field.typeId);
    }
    const { type, offset, name } = field;
    switch (type.kind) {
      case "void":
      case "interface":
      case "anyPointer":
        return undefined;
      case "bool": {
        definitions.push({ name, type: "bool" });
        const byte = offset >>> 3;
        const mask = 1 << (offset & 7);
        const def = field.defaultBits !== 0n;
        return (msg, s) =>
          (byte < s.dataBytes && (msg.view.getUint8(s.data + byte) & mask) !== 0) !== def;
      }
      case "enum": {
        this.#enumConstants(type.typeId, definitions);
        definitions.push({ name, type: "uint16" });
        return primitiveReader("uint16", offset, field.defaultBits);
      }
      case "text": {
        definitions.push({ name, type: "string" });
        const def = field.defaultText ?? "";
        return (msg, s) => (offset < s.ptrCount ? (msg.text(s.ptrs + offset * 8) ?? def) : def);
      }
      case "data":
      case "list":
      case "struct": {
        const read = this.#pointer(type, name, definitions);
        if (!read) {
          return undefined;
        }
        if (type.kind === "struct") {
          return (msg, s) => (offset < s.ptrCount ? read(msg, s.ptrs + offset * 8) : undefined);
        }
        const empty = type.kind === "data" ? () => new Uint8Array() : () => [];
        return (msg, s) => (offset < s.ptrCount ? read(msg, s.ptrs + offset * 8) : empty());
      }
      default:
        definitions.push({ name, type: type.kind });
        return primitiveReader(type.kind, offset, field.defaultBits);
    }
  }

  #enumConstants(typeId: bigint, definitions: MessageDefinitionField[]): void {
    const node = this.#node(typeId);
    if (node.which === "enum") {
      // Like protobuf: names of different enums in one struct may collide.
      node.enumerants.forEach((value, index) => {
        if (!definitions.some((def) => def.isConstant === true && def.name === value)) {
          definitions.push({ name: value, type: "uint16", isConstant: true, value: index });
        }
      });
    }
  }

  /**
   * Reader for a pointer-typed value. `definitions`/`name` receive its datatype when it has one
   * (lists of lists have none).
   */
  #pointer(
    type: TypeInfo,
    name: string | undefined,
    definitions: MessageDefinitionField[] | undefined,
  ): PointerReader | undefined {
    const define = (field: Omit<MessageDefinitionField, "name">) => {
      if (name != undefined) {
        definitions?.push({ name, ...field });
      }
    };
    switch (type.kind) {
      case "text":
        define({ type: "string" });
        return (msg, p) => msg.text(p) ?? "";
      case "data":
        define({ type: "uint8", isArray: true });
        return (msg, p) => msg.data(p) ?? new Uint8Array();
      case "struct": {
        const node = this.#node(type.typeId);
        define({ type: node.displayName, isComplex: true });
        const read = this.struct(type.typeId);
        // An unset struct is undefined, not its defaults: expanding defaults would never end
        // for recursive types.
        return (msg, p) => {
          const s = msg.struct(p);
          return s === EMPTY_STRUCT ? undefined : read(msg, s);
        };
      }
      case "list":
        return this.#list(type.element, name, definitions);
      default:
        return undefined;
    }
  }

  #list(
    element: TypeInfo,
    name: string | undefined,
    definitions: MessageDefinitionField[] | undefined,
  ): PointerReader | undefined {
    const define = (field: Omit<MessageDefinitionField, "name">) => {
      if (name != undefined) {
        definitions?.push({ name, ...field, isArray: true });
      }
    };
    switch (element.kind) {
      case "void":
      case "interface":
      case "anyPointer":
        return undefined;
      case "bool":
        define({ type: "bool" });
        return (msg, p) => {
          if (!msg.list(p)) {
            return [];
          }
          const { count, start, elementSize, stride, elementDataBytes } = msg;
          const out = new Array<boolean>(count);
          for (let i = 0; i < count; i++) {
            // A bool list is a bit list; an upgraded (struct) list keeps the bool in bit 0.
            out[i] =
              elementSize === 1
                ? ((msg.bytes[start + (i >>> 3)]! >> (i & 7)) & 1) === 1
                : elementDataBytes > 0 && (msg.bytes[start + i * stride]! & 1) === 1;
          }
          return out;
        };
      case "enum":
        this.#enumConstants(element.typeId, definitions ?? []);
        define({ type: "uint16" });
        return this.#numericList("uint16");
      case "text":
      case "data":
      case "list": {
        const inner = this.#pointer(element, undefined, undefined);
        if (!inner) {
          return undefined;
        }
        if (element.kind !== "list") {
          define({ type: element.kind === "text" ? "string" : "uint8" });
        }
        return (msg, p) => {
          if (!msg.list(p)) {
            return [];
          }
          const { count, start, stride, elementDataBytes } = msg;
          if (msg.elementPtrCount === 0) {
            throw new Error("Cap'n Proto list of pointers has no pointers");
          }
          const out = new Array<unknown>(count);
          for (let i = 0; i < count; i++) {
            out[i] = inner(msg, start + i * stride + elementDataBytes);
          }
          return out;
        };
      }
      case "struct": {
        const node = this.#node(element.typeId);
        define({ type: node.displayName, isComplex: true });
        const read = this.struct(element.typeId);
        return (msg, p) => {
          if (!msg.list(p)) {
            return [];
          }
          if (msg.elementSize === 1) {
            throw new Error("Cap'n Proto bit list cannot be read as a struct list");
          }
          const { count, start, stride, elementDataBytes, elementPtrCount } = msg;
          const out = new Array<unknown>(count);
          for (let i = 0; i < count; i++) {
            const data = start + i * stride;
            out[i] = read(msg, {
              data,
              dataBytes: elementDataBytes,
              ptrs: data + elementDataBytes,
              ptrCount: elementPtrCount,
            });
          }
          return out;
        };
      }
      default:
        define({ type: element.kind });
        return this.#numericList(element.kind);
    }
  }

  #numericList(kind: Primitive): PointerReader {
    const ArrayType = TYPED_ARRAYS[kind];
    const size = ArrayType.BYTES_PER_ELEMENT;
    const fallback = primitiveReader(kind, 0, 0n);
    return (msg, p) => {
      if (!msg.list(p)) {
        return new ArrayType(0);
      }
      const { count, start, stride, elementDataBytes } = msg;
      if (stride === size && LITTLE_ENDIAN_HOST) {
        // One copy, into a buffer the typed array owns (aligned, does not pin the message).
        return new ArrayType(msg.bytes.slice(start, start + count * size).buffer);
      }
      // Upgraded lists (struct elements whose first field is the value) or big-endian hosts.
      const out = new ArrayType(count);
      for (let i = 0; i < count; i++) {
        const data = start + i * stride;
        (out as unknown as unknown[])[i] = fallback(msg, {
          data,
          dataBytes: elementDataBytes,
          ptrs: data + elementDataBytes,
          ptrCount: 0,
        });
      }
      return out;
    };
  }
}

export function parseCapnprotoSchema(schemaName: string, schemaData: Uint8Array): ParsedChannel {
  const schemaMsg = new Message(schemaData);
  const request = schemaMsg.root();
  const nodes = new Map<bigint, NodeInfo>();
  for (const node of readStructList(schemaMsg, ptr(request, 0), (n) => readNode(schemaMsg, n))) {
    nodes.set(node.id, node);
  }
  const roots = [...nodes.values()].filter(
    (node) => node.which === "struct" && !node.isGroup && node.displayName === schemaName,
  );
  if (roots.length !== 1) {
    throw new Error(
      `Cap'n Proto schema has ${roots.length} non-group structs named ${schemaName}, expected 1`,
    );
  }
  const compiler = new Compiler(nodes);
  const readRoot = compiler.struct(roots[0]!.id);
  return {
    datatypes: compiler.datatypes,
    deserialize: (data) => {
      const msg = new Message(data);
      return readRoot(msg, msg.root());
    },
  };
}
