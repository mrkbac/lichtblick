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
      [7, 0],
      [8, 0],
      [9, 2],
    ]);
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
