// SPDX-License-Identifier: MPL-2.0

import { TimeStretcher } from "./stretch";

const SR = 48000;

function tone(hz: number, seconds: number): Float32Array {
  return Float32Array.from({ length: SR * seconds }, (_, i) =>
    Math.sin((2 * Math.PI * hz * i) / SR),
  );
}

/** Frequency from rising zero crossings, skipping the fade-in of the first frame. */
function frequency(x: Float32Array): number {
  const from = Math.round(SR * 0.05);
  let crossings = 0;
  for (let i = from + 1; i < x.length; i++) {
    if (x[i - 1]! < 0 && x[i]! >= 0) {
      crossings++;
    }
  }
  return crossings / ((x.length - from) / SR);
}

function stretchInChunks(input: Float32Array, speed: number, chunk: number): Float32Array {
  const stretcher = new TimeStretcher(1, SR, speed);
  const parts: Float32Array[] = [];
  for (let i = 0; i < input.length; i += chunk) {
    parts.push(stretcher.push([input.subarray(i, i + chunk)]).planes[0]!);
  }
  const out = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("TimeStretcher", () => {
  it.each([0.25, 0.5, 1, 2, 4])("keeps a 440 Hz tone at 440 Hz at %fx", (speed) => {
    const out = stretchInChunks(tone(440, 2), speed, SR);
    expect(frequency(out)).toBeCloseTo(440, -1);
    // Output length is input / speed, minus what is still held back
    const held = (2 * SR) / speed - out.length;
    expect(held).toBeGreaterThanOrEqual(0);
    expect(held).toBeLessThanOrEqual(new TimeStretcher(1, SR, speed).latency / speed);
  });

  it("gives the same output however the input is chunked, so message boundaries don't click", () => {
    const input = tone(440, 1);
    const whole = stretchInChunks(input, 2, input.length);
    const chunked = stretchInChunks(input, 2, 997);
    expect(chunked).toEqual(whole);
    // A clean 440 Hz sine never jumps more than 2π·440/48000 ≈ 0.058 between samples
    let maxStep = 0;
    for (let i = Math.round(SR * 0.05); i < chunked.length; i++) {
      maxStep = Math.max(maxStep, Math.abs(chunked[i]! - chunked[i - 1]!));
    }
    expect(maxStep).toBeLessThan(0.07);
  });

  it("maps output back to the input position it came from", () => {
    const stretcher = new TimeStretcher(2, SR, 2);
    const first = stretcher.push([tone(440, 0.5), tone(440, 0.5)]);
    expect(first.inputPos).toBe(0);
    expect(first.planes).toHaveLength(2);
    const second = stretcher.push([tone(440, 0.5), tone(440, 0.5)]);
    expect(second.inputPos).toBeCloseTo(first.planes[0]!.length * 2, 0);
  });
});
