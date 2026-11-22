// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { PathSample, PathSampleColumns } from "./PathSampleColumns";

const sample = (sec: number, value: unknown, extra: Partial<PathSample> = {}): PathSample => ({
  receiveTime: { sec, nsec: 7 },
  headerStamp: undefined,
  count: 1,
  value,
  constantName: undefined,
  ...extra,
});

describe("PathSampleColumns", () => {
  it("round-trips samples", () => {
    const samples = [
      sample(1, 3, { headerStamp: { sec: 5, nsec: 6 }, constantName: "C" }),
      sample(2, "a"),
      sample(3, null),
      sample(4, undefined, { count: 2 }),
      sample(5, 7n),
      sample(6, { nested: true }),
    ];
    const columns = PathSampleColumns.from(samples);
    expect(columns.toArray()).toEqual([...samples.slice(0, 5), sample(6, undefined)]);
    expect(columns.at(6)).toBeUndefined();
  });

  it("thins repeats first, keeping every change and the newest sample", () => {
    const columns = new PathSampleColumns(8);
    const values = [0, 0, 0, 1, 1, 1, 0, 0, 0, 2];
    values.forEach((value, i) => {
      columns.push(sample(i, value));
    });
    expect(columns.toArray().map((s) => [s.receiveTime.sec, s.value])).toEqual([
      [0, 0],
      [2, 0],
      [3, 1],
      [5, 1],
      [6, 0],
      [8, 0],
      [9, 2],
    ]);
    expect(columns.isExact()).toBe(true);
  });

  it("keeps signed and full unsigned 32-bit seconds", () => {
    const stamps = [
      { sec: -1, nsec: 5 },
      { sec: -(2 ** 31), nsec: 999_999_999 },
      { sec: 4_294_967_295, nsec: 0 },
      { sec: 0, nsec: 0 },
    ];
    const columns = PathSampleColumns.from(
      stamps.map((headerStamp, i) => sample(i - 1, 1, { headerStamp })),
    );
    expect(stamps.map((_, i) => columns.headerStamp(i))).toEqual(stamps);
    expect(columns.receiveTime(0)).toEqual({ sec: -1, nsec: 7 });
  });

  it("keeps every value change exactly while the changes fit", () => {
    const columns = new PathSampleColumns(100);
    const changes: number[] = [];
    let value = 0;
    for (let i = 0; i < 10_000; i++) {
      // 60 runs alternating true/false, each 100-250 samples long.
      if (i % 167 === 0) {
        value = 1 - value;
        changes.push(i);
      }
      columns.push(sample(i, value === 1));
    }
    const kept = columns.toArray();
    const keptChanges = kept
      .filter((s, i) => i === 0 || s.value !== kept[i - 1]!.value)
      .map((s) => s.receiveTime.sec);
    expect(keptChanges).toEqual(changes);
    expect(kept.at(-1)?.receiveTime.sec).toBe(9_999);
    expect(columns.isExact()).toBe(true);
  });

  it("says when thinning may have merged changes", () => {
    const columns = new PathSampleColumns(100);
    for (let i = 0; i < 1000; i++) {
      columns.push(sample(i, i % 2 === 0));
    }
    expect(columns.isExact()).toBe(false);
  });

  it("keeps the header-stamped samples of a run", () => {
    const columns = new PathSampleColumns(8);
    for (let i = 0; i < 40; i++) {
      const stamped = i === 20 || i === 21;
      columns.push(sample(i, "A", stamped ? { headerStamp: { sec: i, nsec: 0 } } : {}));
    }
    const stamps = columns.toArray().filter((s) => s.headerStamp != undefined);
    expect(stamps.length).toBeGreaterThan(0);
  });

  it("keeps the value table bounded when overwritten samples have unique values", () => {
    const columns = new PathSampleColumns(100);
    for (let i = 0; i < 200_000; i++) {
      columns.push(sample(i, i));
    }
    expect(columns.distinctValues()).toBeLessThanOrEqual(1025);
  });

  it("keeps the whole span when every sample is a change", () => {
    const columns = new PathSampleColumns(100);
    for (let i = 0; i < 10_000; i++) {
      columns.push(sample(i, i));
    }
    expect(columns.size()).toBeLessThanOrEqual(100);
    expect(columns.at(0)?.receiveTime.sec).toBe(0);
    expect(columns.at(columns.size() - 1)?.receiveTime.sec).toBe(9_999);
    // Evenly spread: no gap is more than a few times the average.
    const secs = columns.toArray().map((s) => s.receiveTime.sec);
    const gaps = secs.slice(1).map((sec, i) => sec - secs[i]!);
    expect(Math.max(...gaps)).toBeLessThan((4 * 10_000) / columns.size());
    // Values no kept sample uses are forgotten.
    expect(new Set(columns.toArray().map((s) => s.value)).size).toBe(columns.size());
  });

  it("rejects an unbounded budget", () => {
    expect(() => new PathSampleColumns(Infinity)).toThrow(RangeError);
  });
});
