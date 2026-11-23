// SPDX-License-Identifier: MPL-2.0

import { RingBuffer } from "./RingBuffer";

describe("RingBuffer", () => {
  it("rejects an unbounded or invalid capacity", () => {
    expect(() => new RingBuffer(Infinity)).toThrow(RangeError);
    expect(() => new RingBuffer(-1)).toThrow(RangeError);
    expect(() => new RingBuffer(1.5)).toThrow(RangeError);
    expect(() => new RingBuffer(Number.NaN)).toThrow(RangeError);
  });

  it("keeps the newest items in order once full", () => {
    const buffer = RingBuffer.from(3, [1, 2, 3, 4, 5]);
    expect(buffer.toArray()).toEqual([3, 4, 5]);
    expect([...buffer]).toEqual([3, 4, 5]);
    expect(buffer.size()).toBe(3);
    expect(buffer.at(0)).toBe(3);
    expect(buffer.last()).toBe(5);
    expect(buffer.at(3)).toBeUndefined();
    expect(buffer.at(-1)).toBeUndefined();
  });

  it("drops everything with capacity 0", () => {
    const buffer = RingBuffer.from(0, [1, 2]);
    expect(buffer.size()).toBe(0);
    expect(buffer.last()).toBeUndefined();
  });
});
