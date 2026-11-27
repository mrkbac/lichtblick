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
    expect(columns.changes()).toBe(columns);
  });

  it("concatenates earlier samples in front, thinned to the later one's budget", () => {
    const earlier = PathSampleColumns.from([0, 1, 2].map((sec) => sample(sec, sec)));
    const later = new PathSampleColumns(8);
    for (let sec = 3; sec < 6; sec++) {
      later.push(sample(sec, sec));
    }
    const merged = PathSampleColumns.concat(earlier, later);
    expect(merged.toArray().map((s) => s.receiveTime.sec)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(merged.maxSamples).toBe(8);
    expect(merged.hasAllChanges()).toBe(true);

    // Merged samples on either side: the result can't claim to have every change
    const thinned = new PathSampleColumns(4);
    for (let sec = 10; sec < 30; sec++) {
      thinned.push(sample(sec, sec));
    }
    expect(thinned.hasAllChanges()).toBe(false);
    expect(PathSampleColumns.concat(earlier, thinned).hasAllChanges()).toBe(false);
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
    expect(columns.changes()).toBe(columns);
  });

  it("keeps every change apart once merging starts, when tracking changes", () => {
    const columns = new PathSampleColumns(100);
    columns.trackChanges();
    for (let i = 0; i < 1000; i++) {
      columns.push(sample(i, i % 3));
    }
    expect(columns.size()).toBeLessThanOrEqual(100);
    const changes = columns.changes().toArray();
    // The record keeps the newest changes, each one exactly.
    expect(changes.length).toBeGreaterThanOrEqual(75);
    const first = changes[0]!.receiveTime.sec;
    expect(changes.map((s) => [s.receiveTime.sec, s.value])).toEqual(
      Array.from({ length: 1000 - first }, (_, i) => [first + i, (first + i) % 3]),
    );
  });

  it("bounds the changes record by forgetting its oldest changes", () => {
    const columns = new PathSampleColumns(100);
    columns.trackChanges();
    for (let i = 0; i < 10_000; i++) {
      columns.push(sample(i, i % 2));
    }
    const changes = columns.changes();
    expect(changes.size()).toBeLessThanOrEqual(100);
    expect(changes.at(changes.size() - 1)?.receiveTime.sec).toBe(9_999);
    expect(columns.hasAllChanges()).toBe(false);
  });

  it("keeps no changes record unless asked to", () => {
    const columns = new PathSampleColumns(100);
    for (let i = 0; i < 10_000; i++) {
      columns.push(sample(i, i % 2));
    }
    expect(columns.changes()).toBe(columns);
  });

  it("marks merged stretches that held several values instead of aliasing", () => {
    const columns = new PathSampleColumns(100);
    for (let i = 0; i < 10_000; i++) {
      columns.push(sample(i, i % 2));
    }
    expect(columns.size()).toBeLessThanOrEqual(100);
    const mixed = Array.from({ length: columns.size() }, (_, i) => columns.isMixed(i));
    // All but the newest group, which has nothing merged into it yet.
    expect(mixed.filter(Boolean).length).toBeGreaterThanOrEqual(columns.size() - 2);
  });

  it("stores plain numbers without the value table", () => {
    const values = [0.5, -1.25, 3, Number.MAX_VALUE, 0.5];
    const columns = PathSampleColumns.from(values.map((value, i) => sample(i, value)));
    expect(columns.toArray().map((s) => s.value)).toEqual(values);
    expect(columns.distinctValues()).toBe(0);
    expect(columns.sameValue(0, 4)).toBe(true);
    expect(columns.sameValue(0, 1)).toBe(false);
    // An enum keeps its constant name, so it goes through the table.
    const named = PathSampleColumns.from([sample(0, 2, { constantName: "TWO" })]);
    expect(named.at(0)?.constantName).toBe("TWO");
    expect(named.distinctValues()).toBe(1);
  });

  it("thins runs of null like any other value", () => {
    const columns = new PathSampleColumns(100);
    for (let i = 0; i < 10_000; i++) {
      // Mostly gaps, with a short run of 1 every 1000 samples.
      columns.push(sample(i, i % 1000 < 3 ? 1 : null));
    }
    expect(columns.changes()).toBe(columns);
    const kept = columns.toArray();
    expect(kept.filter((s) => s.value === 1).length).toBeGreaterThanOrEqual(10);
    expect(kept.at(-1)?.receiveTime.sec).toBe(9_999);
  });

  it("treats a stamp without a 32-bit form as missing, and converts bigints", () => {
    const columns = PathSampleColumns.from([
      sample(1, 1, { headerStamp: { sec: 5n as unknown as number, nsec: 6 } }),
      sample(2, 1, { headerStamp: { sec: 2 ** 32, nsec: 0 } }),
      sample(3, 1, { headerStamp: { sec: 2 ** 40, nsec: 0 } }),
      sample(4, 1, { headerStamp: { sec: 1, nsec: Number.NaN } }),
      sample(5, 1, { headerStamp: { sec: 1, nsec: 1e9 } }),
      sample(6, 1, { headerStamp: { sec: 1.5, nsec: 0 } }),
    ]);
    expect(columns.toArray().map((s) => s.headerStamp)).toEqual([
      { sec: 5, nsec: 6 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
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

  it("keeps the last stamped sample of a run before unstamped repeats", () => {
    const columns = new PathSampleColumns(12);
    // Runs of 3 thin to level 2 (run ends dropped) without needing to merge.
    for (let i = 0; i < 24; i++) {
      columns.push(sample(i, Math.floor(i / 3)));
    }
    // Then a run of "A" whose header stamps stop part way.
    for (let i = 24; i < 29; i++) {
      columns.push(sample(i, "A", i < 27 ? { headerStamp: { sec: i, nsec: 0 } } : {}));
    }
    columns.push(sample(29, "B"));
    expect(columns.changes()).toBe(columns);
    const kept = columns.toArray().map((s) => s.receiveTime.sec);
    expect(kept).not.toContain(1); // run ends are dropped: this is level 2
    // 26 is where "A" ends when drawn by header stamp.
    expect(kept).toContain(26);
  });

  it("keeps header-stamped samples when merging, so a row drawn by stamp can't vanish", () => {
    const columns = new PathSampleColumns(100);
    for (let i = 0; i < 10_000; i++) {
      // Every sample changes, and only even ones have a header stamp.
      columns.push(sample(i, i % 2, i % 2 === 0 ? { headerStamp: { sec: i, nsec: 0 } } : {}));
    }
    const kept = columns.toArray();
    expect(kept.length).toBeLessThanOrEqual(100);
    expect(kept.filter((s) => s.headerStamp != undefined).length).toBeGreaterThan(kept.length / 2);
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
