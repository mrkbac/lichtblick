// SPDX-License-Identifier: MPL-2.0

import { playheadWindows } from "./trackReads";

const S = 1_000_000_000n;

/** The windows cover [start, end] exactly once */
function expectCover(windows: ReturnType<typeof playheadWindows>, start: bigint, end: bigint) {
  const sorted = [...windows].sort((a, b) => (a.start < b.start ? -1 : 1));
  expect(sorted[0]!.start).toBe(start);
  expect(sorted.at(-1)!.end).toBe(end);
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i]!.start).toBe(sorted[i - 1]!.end + 1n);
  }
}

describe("playheadWindows", () => {
  it("reads around the playhead first, then backwards, then forwards", () => {
    const windows = playheadWindows(0n, 1000n * S, 500n * S);
    expect(windows[0]!.direction).toBe("around");
    expect(windows[0]!.start).toBeLessThanOrEqual(500n * S);
    expect(windows[0]!.end).toBeGreaterThanOrEqual(500n * S);
    const directions = windows.map((w) => w.direction);
    expect(directions.lastIndexOf("before")).toBeLessThan(directions.indexOf("after"));
    // Backwards windows go further back each time
    const before = windows.filter((w) => w.direction === "before");
    for (let i = 1; i < before.length; i++) {
      expect(before[i]!.end).toBeLessThan(before[i - 1]!.start);
    }
    expectCover(windows, 0n, 1000n * S);
    expect(windows.length).toBeLessThan(16);
  });

  it.each([
    ["at the start", 0n],
    ["at the end", 100n * S],
    ["before the range", -5n * S],
    ["after the range", 500n * S],
  ])("covers the range with the playhead %s", (_name, playhead) => {
    expectCover(playheadWindows(0n, 100n * S, playhead), 0n, 100n * S);
  });

  it("reads a short recording at once", () => {
    expect(playheadWindows(0n, 5n * S, 2n * S)).toEqual([
      { start: 0n, end: 5n * S, direction: "around" },
    ]);
  });
});
