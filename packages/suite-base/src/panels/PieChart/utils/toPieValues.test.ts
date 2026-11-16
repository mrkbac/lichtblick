// SPDX-License-Identifier: MPL-2.0

import { toPieValues } from "./toPieValues";

describe("toPieValues", () => {
  it("reads a Float32Array, as binary decoders produce for float32[]", () => {
    expect(toPieValues([new Float32Array([1, 2.5, 3])])).toEqual(new Float32Array([1, 2.5, 3]));
  });

  it("reads other typed arrays", () => {
    expect(toPieValues([new Uint32Array([4, 5])])).toEqual(new Float32Array([4, 5]));
    expect(toPieValues([new Float64Array([0.5])])).toEqual(new Float32Array([0.5]));
    expect(toPieValues([new BigInt64Array([7n, 8n])])).toEqual(new Float32Array([7, 8]));
  });

  it("reads plain, nested and scalar values", () => {
    expect(toPieValues([[1, 2, 3]])).toEqual(new Float32Array([1, 2, 3]));
    expect(toPieValues([1, 2])).toEqual(new Float32Array([1, 2]));
    expect(toPieValues([[[1], [2, new Int8Array([3])]]])).toEqual(new Float32Array([1, 2, 3]));
  });

  it("rejects empty and non-numeric results", () => {
    expect(() => toPieValues([])).toThrow("no values");
    expect(() => toPieValues([new Float32Array()])).toThrow("no values");
    expect(() => toPieValues([["a", 1]])).toThrow("numbers");
    expect(() => toPieValues([{ x: 1 }])).toThrow("numbers");
    expect(() => toPieValues([new Float32Array([1, NaN])])).toThrow("numbers");
  });
});
