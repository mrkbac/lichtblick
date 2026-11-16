// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import fs from "fs";

import { parseChannel } from "./parseChannel";

// Schema and messages from fixtures/capnp/test.capnp, written by fixtures/capnp/gen.py.
const fixture = (name: string) =>
  new Uint8Array(fs.readFileSync(`${__dirname}/fixtures/capnp/${name}`));

const parse = (name: string) =>
  parseChannel({
    messageEncoding: "capnproto",
    schema: { name, encoding: "capnproto", data: fixture("schema.bin") },
  });

describe("capnproto", () => {
  it("decodes every field kind", () => {
    const msg = parse("test.capnp:All").deserialize(fixture("msg_full.bin"));
    expect(msg).toEqual({
      b: true,
      i8: -8,
      i16: -1600,
      i32: -320000,
      i64: -(2n ** 62n),
      u8: 250,
      u16: 65000,
      u32: 4000000000,
      u64: 2n ** 63n + 5n,
      f32: 1.25,
      f64: -2.5e300,
      text: "héllo",
      data: new Uint8Array([0, 1, 255]),
      color: 1,
      point: { x: 1, y: 2 },
      points: [
        { x: 3, y: 0 },
        { x: 0, y: 4 },
      ],
      floats: new Float32Array([0.5, 1.5, 2.5]),
      bools: [true, false, true, true, false, false, false, false, true],
      texts: ["a", "", "bc"],
      nested: [new Int32Array([1, 2]), new Int32Array(), new Int32Array([3])],
      colors: new Uint16Array([2, 0]),
      // Explicitly set to values other than their defaults (42, 1.5, true).
      defI32: 7,
      defF64: 0,
      defB: false,
      defText: "hello",
      word: "w",
      grp: { a: -3, b: "g" },
      shape: { square: { x: 9, y: 0 } },
      i64s: new BigInt64Array([-1n, 2n ** 60n]),
      u8s: new Uint8Array([1, 2, 3]),
      defColor: 2,
      datas: [new Uint8Array([97, 98]), new Uint8Array()],
      self: expect.objectContaining({ i32: 5, num: 11, defI32: 42, point: undefined }),
    });
  });

  it("decodes unset fields as their defaults and unset structs as undefined", () => {
    const msg = parse("test.capnp:All").deserialize(fixture("msg_empty.bin")) as Record<
      string,
      unknown
    >;
    expect(msg).toMatchObject({
      b: false,
      i64: 0n,
      text: "",
      data: new Uint8Array(),
      floats: new Float32Array(),
      defI32: 42,
      defF64: 1.5,
      defB: true,
      defText: "hello",
      defColor: 2,
      none: null, // active Void union member
      shape: { circle: 0 },
    });
    expect(msg.point).toBeUndefined();
    expect(msg.self).toBeUndefined();
    expect("num" in msg).toBe(false); // inactive union members are absent
  });

  it("follows far pointers across segments", () => {
    const msg = parse("test.capnp:All").deserialize(fixture("msg_big.bin")) as {
      i32: number;
      text: string;
      u8s: Uint8Array;
      floats: Float32Array;
    };
    expect(msg.i32).toBe(1);
    expect(msg.text).toBe("tail");
    expect(msg.u8s).toHaveLength(10240);
    expect(msg.u8s[257]).toBe(1);
    expect(msg.floats).toHaveLength(3000);
    expect(msg.floats[2999]).toBe(2999);
  });

  it("returns views into the message, copying only misaligned numeric lists", () => {
    const data = fixture("msg_full.bin");
    const decoder = parse("test.capnp:All");
    const msg = decoder.deserialize(data) as { floats: Float32Array; data: Uint8Array };
    expect(msg.floats.buffer).toBe(data.buffer);
    expect(msg.data.buffer).toBe(data.buffer);

    const shifted = new Uint8Array(data.length + 1);
    shifted.set(data, 1);
    const misaligned = decoder.deserialize(shifted.subarray(1)) as typeof msg;
    expect(misaligned.floats).toEqual(new Float32Array([0.5, 1.5, 2.5]));
    expect(misaligned.floats.buffer).not.toBe(shifted.buffer);
    expect(misaligned.data.buffer).toBe(shifted.buffer);
  });

  it("builds datatypes with groups, enums and nested structs", () => {
    const { datatypes } = parse("test.capnp:All");
    const all = datatypes.get("test.capnp:All")!.definitions;
    expect(all.find((f) => f.name === "point")).toEqual({
      name: "point",
      type: "test.capnp:Point",
      isComplex: true,
    });
    expect(all.find((f) => f.name === "floats")).toEqual({
      name: "floats",
      type: "float32",
      isArray: true,
    });
    expect(all.find((f) => f.name === "grp")).toEqual({
      name: "grp",
      type: "test.capnp:All.grp",
      isComplex: true,
    });
    // Three Color fields share one set of constants.
    expect(all.filter((f) => f.isConstant === true).map((f) => f.name)).toEqual([
      "red",
      "green",
      "blue",
    ]);
    expect(datatypes.get("test.capnp:All.grp")!.definitions).toEqual([
      { name: "a", type: "int16" },
      { name: "b", type: "string" },
    ]);
    expect(datatypes.has("test.capnp:Point")).toBe(true);
  });

  it("rejects a root name that matches no struct", () => {
    expect(() => parse("test.capnp:Missing")).toThrow(/0 non-group structs named/);
    expect(() => parse("test.capnp:All.grp")).toThrow(/0 non-group structs named/);
  });

  it("rejects truncated messages", () => {
    const data = fixture("msg_full.bin");
    expect(() => parse("test.capnp:All").deserialize(data.subarray(0, data.length - 8))).toThrow(
      /truncated/,
    );
  });

  it("stops messages that point many pointers at the same data", () => {
    // Amp { items: List(Data) } where all N items point at one K-word blob: N * K words to read
    // from a message of N + K words.
    const N = 1000;
    const K = 1000;
    const words = 2 + N + K;
    const view = new DataView(new ArrayBuffer(8 + words * 8));
    view.setUint32(4, words, true); // one segment
    const word = (i: number, lo: number, hi: number) => {
      view.setUint32(8 + i * 8, lo, true);
      view.setUint32(8 + i * 8 + 4, hi, true);
    };
    word(0, 0, 1 << 16); // root: struct, 0 data words, 1 pointer
    word(1, 1, (N << 3) | 6); // items: list of N pointers
    for (let i = 0; i < N; i++) {
      word(2 + i, ((N - i - 1) << 2) | 1, ((K * 8) << 3) | 2); // Data of K words at word 2 + N
    }
    const amp = parse("test.capnp:Amp");
    expect(() => amp.deserialize(new Uint8Array(view.buffer))).toThrow(/traversal limit/);
  });
});
