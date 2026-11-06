// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { autoBinCount, computeHistogram, computeSpectrum, fft } from "./analysis";

/** Index of the largest value */
const argMax = (values: Float64Array): number =>
  values.reduce((best, value, i) => (value > values[best]! ? i : best), 0);

describe("fft", () => {
  it("matches a direct DFT", () => {
    const n = 16;
    const input = Array.from({ length: n }, (_, i) => Math.sin(i * 1.3) + (i % 3));
    const re = Float64Array.from(input);
    const im = new Float64Array(n);

    fft(re, im);

    for (let k = 0; k < n; k++) {
      let dftRe = 0;
      let dftIm = 0;
      for (let i = 0; i < n; i++) {
        dftRe += input[i]! * Math.cos((-2 * Math.PI * k * i) / n);
        dftIm += input[i]! * Math.sin((-2 * Math.PI * k * i) / n);
      }
      expect(re[k]).toBeCloseTo(dftRe, 9);
      expect(im[k]).toBeCloseTo(dftIm, 9);
    }
  });
});

describe("computeSpectrum", () => {
  const sine = (xs: number[], hz: number, amplitude: number, offset = 0) =>
    Float64Array.from(xs, (x) => offset + amplitude * Math.sin(2 * Math.PI * hz * x));

  it("finds the frequency and amplitude of a sine, ignoring its offset", () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i / 100);

    const spectrum = computeSpectrum(Float64Array.from(xs), sine(xs, 7, 2, 50), 0, xs.length)!;

    const peak = argMax(spectrum.y);
    expect(spectrum.x[peak]).toBeCloseTo(7, 1);
    expect(spectrum.y[peak]).toBeGreaterThan(1.7);
    expect(spectrum.y[peak]).toBeLessThan(2.1);
    // The offset is removed, so there is no DC peak
    expect(spectrum.y[0]).toBeLessThan(0.01);
    // Frequencies go up to Nyquist (50 Hz)
    expect(spectrum.x[spectrum.x.length - 1]).toBeCloseTo(50, 0);
  });

  it("handles jittered and dropped samples", () => {
    // ~100 Hz with timing jitter and every 7th sample dropped
    const xs: number[] = [];
    for (let i = 0; i < 2000; i++) {
      if (i % 7 !== 3) {
        xs.push(i / 100 + 0.002 * Math.sin(i * 12.9898));
      }
    }

    const spectrum = computeSpectrum(Float64Array.from(xs), sine(xs, 12, 1), 0, xs.length)!;

    expect(spectrum.x[argMax(spectrum.y)]).toBeCloseTo(12, 0);
  });

  it("skips NaN rows and rows outside the range", () => {
    const xs = Float64Array.from({ length: 300 }, (_, i) => i / 100);
    const ys = sine([...xs], 4, 1);
    ys[10] = NaN;
    ys[250] = 1e9;

    const spectrum = computeSpectrum(xs, ys, 0, 200)!;

    expect(spectrum.x[argMax(spectrum.y)]).toBeCloseTo(4, 0);
    expect(Math.max(...spectrum.y)).toBeLessThan(1.2);
  });

  it("needs a few samples", () => {
    expect(computeSpectrum(Float64Array.of(0, 1, 2), Float64Array.of(1, 2, 3), 0, 3)).toBe(
      undefined,
    );
  });
});

describe("autoBinCount", () => {
  it("uses Sturges for few values", () => {
    expect(autoBinCount(Float64Array.of(1, 2, 3, 4, 5, 6, 7, 8))).toBe(4);
  });

  it("uses Freedman-Diaconis for many spread values", () => {
    const sorted = Float64Array.from({ length: 10_000 }, (_, i) => i);
    // IQR 4999.5, width 2 * 4999.5 / cbrt(10000) ≈ 464
    expect(autoBinCount(sorted)).toBe(22);
  });

  it("is one bin for constant values", () => {
    expect(autoBinCount(Float64Array.of(3, 3, 3))).toBe(1);
  });
});

describe("computeHistogram", () => {
  it("counts finite values per bin, including the maximum in the last bin", () => {
    const ys = Float64Array.of(0, 0.5, 1, 2, NaN, 3, 4);

    const histogram = computeHistogram(ys, 0, ys.length, 4)!;

    expect([...histogram.edges]).toEqual([0, 1, 2, 3, 4]);
    expect([...histogram.counts]).toEqual([2, 1, 1, 2]);
  });

  it("returns a closed step outline", () => {
    const histogram = computeHistogram(Float64Array.of(0, 1, 1), 0, 3, 2)!;

    expect([...histogram.x]).toEqual([0, 0, 0.5, 0.5, 1, 1]);
    expect([...histogram.y]).toEqual([0, 1, 1, 2, 2, 0]);
  });

  it("centers one bin on constant values", () => {
    const histogram = computeHistogram(Float64Array.of(5, 5), 0, 2)!;

    expect([...histogram.edges]).toEqual([4.5, 5.5]);
    expect([...histogram.counts]).toEqual([2]);
  });

  it("is undefined without finite values", () => {
    expect(computeHistogram(Float64Array.of(NaN), 0, 1)).toBeUndefined();
  });
});
