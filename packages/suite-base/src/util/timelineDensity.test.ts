// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { addSpan, GrowingHistogram } from "./timelineDensity";

describe("addSpan", () => {
  it("spreads an amount over the buckets a span overlaps", () => {
    const buckets = new Float32Array(4);
    addSpan(buckets, 0, 4, 0.5, 2.5, 4);
    expect([...buckets]).toEqual([1, 2, 1, 0]);
  });

  it("drops the part of a span outside the range", () => {
    const buckets = new Float32Array(2);
    addSpan(buckets, 0, 2, -2, 2, 8);
    expect([...buckets]).toEqual([2, 2]);
    addSpan(buckets, 0, 2, 3, 4, 8);
    expect([...buckets]).toEqual([2, 2]);
  });

  it("puts an instant into its bucket, the end into the last one", () => {
    const buckets = new Float32Array(2);
    addSpan(buckets, 0, 2, 1.5, 1.5, 1);
    addSpan(buckets, 0, 2, 2, 2, 1);
    addSpan(buckets, 5, 5, 5, 5, 1);
    expect([...buckets]).toEqual([1, 2]);
  });
});

describe("GrowingHistogram", () => {
  it("keeps totals and gaps when it grows past its first range", () => {
    const histogram = new GrowingHistogram(0, 10);
    histogram.add(0, 10, 10);
    histogram.add(30, 40, 10);
    const out = histogram.resample(0, 40);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(20);
    // [10, 30) has no data
    expect(
      out.slice(Math.ceil(out.length / 4), Math.floor((out.length * 3) / 4)).every((b) => b === 0),
    ).toBe(true);
    expect(out[0]).toBeGreaterThan(0);
    expect(out[out.length - 1]).toBeGreaterThan(0);
  });
});
