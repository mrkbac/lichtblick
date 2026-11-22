// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  lastIndexAtOrBefore,
  nearestFix,
  SampleStore,
  thinTrack,
  thinViewCovers,
  thinViewFor,
  TrackStore,
} from "./track";

function storeOf(count: number, lngLat: (i: number) => [number, number]): TrackStore {
  const store = new TrackStore("/fix");
  for (let i = 0; i < count; i++) {
    const [longitude, latitude] = lngLat(i);
    store.push({
      topic: "/fix",
      schemaName: "sensor_msgs/NavSatFix",
      receiveTime: { sec: 1_700_000_000 + i, nsec: 123_456_789 },
      sizeInBytes: 0,
      message: { longitude, latitude, altitude: i, status: { status: 0, service: 1 } },
    });
  }
  return store;
}

describe("ColumnStore", () => {
  it("thins evenly past its limit and keeps the newest row", () => {
    const store = new SampleStore(8);
    for (let t = 0; t < 100; t++) {
      store.push(t, t);
      const times = [...store.columns.time.subarray(0, store.length)];
      expect(store.length).toBeLessThanOrEqual(8);
      expect(times[times.length - 1]).toBe(t);
      // Every gap but the one to the newest row is the same.
      const gaps = new Set(times.slice(1, -1).map((time, i) => time - times[i]!));
      expect(gaps.size).toBeLessThanOrEqual(1);
    }
    expect([...store.columns.time.subarray(0, store.length)]).toEqual([
      0, 16, 32, 48, 64, 80, 96, 99,
    ]);
  });

  it("clears", () => {
    const store = new SampleStore(4);
    for (let t = 0; t < 10; t++) {
      store.push(t, t);
    }
    store.clear();
    store.push(1, 2);
    store.push(2, 3);
    expect(store.length).toBe(2);
    expect([...store.columns.value.subarray(0, 2)]).toEqual([2, 3]);
  });
});

describe("TrackStore", () => {
  it("rebuilds the fix with its exact time", () => {
    const store = storeOf(20, (i) => [i, -i]);
    expect(store.message(19)).toEqual({
      topic: "/fix",
      schemaName: "sensor_msgs/NavSatFix",
      receiveTime: { sec: 1_700_000_019, nsec: 123_456_789 },
      sizeInBytes: 0,
      message: { longitude: 19, latitude: -19, altitude: 19, status: { status: 0, service: 1 } },
    });
  });
});

describe("lastIndexAtOrBefore", () => {
  it("binary searches sorted times", () => {
    const times = [1, 2, 2, 3];
    expect(lastIndexAtOrBefore(times, 4, 0)).toBe(-1);
    expect(lastIndexAtOrBefore(times, 4, 2)).toBe(2);
    expect(lastIndexAtOrBefore(times, 4, 2.5)).toBe(2);
    expect(lastIndexAtOrBefore(times, 4, 9)).toBe(3);
    expect(lastIndexAtOrBefore(times, 2, 9)).toBe(1);
  });
});

describe("thinTrack", () => {
  // 10k fixes ~1 m apart heading east.
  const store = storeOf(10_000, (i) => [i * 1e-5, 0]);

  it("keeps fixes at least the given pixels apart, and both ends", () => {
    const { indices, runs } = thinTrack(store, { zoom: 20, minPixels: 1, budget: 1e6 });
    expect(runs).toEqual([0]);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(9_999);
    // A pixel is ~0.15 m at zoom 20, so every fix is kept.
    expect(indices.length).toBe(10_000);
    // At zoom 10 a pixel is ~150 m, so about every 70th fix is kept.
    const coarse = thinTrack(store, { zoom: 10, minPixels: 1, budget: 1e6 }).indices;
    expect(coarse.length).toBeGreaterThan(100);
    expect(coarse.length).toBeLessThan(200);
    expect(coarse[coarse.length - 1]).toBe(9_999);
  });

  it("stays under the budget", () => {
    const { indices } = thinTrack(store, { zoom: 20, minPixels: 1, budget: 500 });
    expect(indices.length).toBeLessThanOrEqual(500);
    expect(indices.length).toBeGreaterThan(100);
  });

  it("drops fixes outside the viewport and starts a new run after a gap", () => {
    const { indices, runs } = thinTrack(store, {
      zoom: 22,
      minPixels: 1,
      budget: 1e6,
      viewport: { west: 0.01, east: 0.02, south: -1, north: 1 },
    });
    // 1000..2000 are inside; 999 and 2001 lead the line out of view.
    expect(indices[0]).toBe(999);
    expect(indices[indices.length - 1]).toBe(2_001);
    expect(runs).toEqual([0]);

    const twoParts = thinTrack(
      storeOf(30, (i) => [i < 10 || i >= 20 ? 0 : 50, 0]),
      {
        zoom: 1,
        minPixels: 0,
        budget: 1e6,
        viewport: { west: -1, east: 1, south: -1, north: 1 },
      },
    );
    expect([...twoParts.indices]).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
    ]);
    expect(twoParts.runs).toEqual([0, 11]);
  });
});

describe("thinTrack with sparse or zigzagging tracks", () => {
  it("keeps a segment crossing the viewport with both ends outside it", () => {
    const store = storeOf(2, (i) => [i === 0 ? -1 : 1, 0]);
    const { indices, runs } = thinTrack(store, {
      zoom: 10,
      minPixels: 1,
      budget: 100,
      viewport: { west: -0.1, east: 0.1, south: -0.1, north: 0.1 },
    });
    expect([...indices]).toEqual([0, 1]);
    expect(runs).toEqual([0]);
  });

  it("stays under the budget when run ends alone exceed it", () => {
    // Every other fix is outside the viewport: each visible fix is the end of a run.
    const store = storeOf(150_000, (i) => [i % 2 === 0 ? 0 : 10, i % 4 < 2 ? 0 : 0.5]);
    const viewport = { west: -1, east: 1, south: -1, north: 1 };
    const { indices, runs } = thinTrack(store, {
      zoom: 18,
      minPixels: 1,
      budget: 50_000,
      viewport,
    });
    expect(indices.length).toBeLessThanOrEqual(50_000);
    expect(indices.length).toBeGreaterThan(25_000);
    expect(runs[0]).toBe(0);
    expect(runs.every((run, i) => i === 0 || run > runs[i - 1]!)).toBe(true);
  });
});

describe("thinTrack over budget with many short runs", () => {
  it("keeps each crossing line as a line, not a dot", () => {
    // Groups of A(-1,0) → B(1,0) crossing the viewport, then a detour around it via C and D.
    const corners: [number, number][] = [
      [-1, 0],
      [1, 0],
      [1, 50],
      [-1, 50],
    ];
    const store = storeOf(160_000, (i) => corners[i % 4]!);
    const viewport = { west: -0.1, east: 0.1, south: -0.1, north: 0.1 };
    const { indices, runs } = thinTrack(store, {
      zoom: 18,
      minPixels: 1,
      budget: 50_000,
      viewport,
    });
    expect(indices.length).toBeLessThanOrEqual(50_000);
    expect(runs.length).toBeGreaterThanOrEqual(20_000);
    runs.forEach((start, r) => {
      const end = runs[r + 1] ?? indices.length;
      expect(end - start).toBe(2);
      expect(store.lngLat(indices[start]!)).toEqual([-1, 0]);
      expect(store.lngLat(indices[start + 1]!)).toEqual([1, 0]);
    });
  });
});

describe("thinViewCovers", () => {
  const bounds = { west: 0, east: 1, south: 0, north: 1 };
  const view = thinViewFor(10, bounds);

  it("keeps the thinned track for small moves and zooms", () => {
    expect(thinViewCovers(view, 10, { west: 0.5, east: 1.5, south: 0.5, north: 1.5 })).toBe(true);
    expect(thinViewCovers(view, 10.1, bounds)).toBe(true);
  });

  it("re-thins after leaving the padding or zooming further", () => {
    expect(thinViewCovers(view, 10, { west: 1.5, east: 2.5, south: 0, north: 1 })).toBe(false);
    expect(thinViewCovers(view, 11, bounds)).toBe(false);
    expect(thinViewCovers(view, 9, { west: -1, east: 2, south: -1, north: 2 })).toBe(false);
  });
});

describe("nearestFix", () => {
  it("finds the full-resolution fix nearest to the cursor between the kept neighbors", () => {
    const store = storeOf(100, (i) => [i * 1e-3, 0]);
    const kept = Uint32Array.of(0, 50, 99);
    expect(nearestFix(store, kept, 1, [0.0303, 0])).toBe(30);
    // Not past the kept neighbors.
    expect(nearestFix(store, kept, 0, [0.07, 0])).toBe(49);
  });

  it("finds the fix from another copy of the world", () => {
    const store = storeOf(3, (i) => [170 + i * 5, 0]);
    const kept = Uint32Array.of(0, 2);
    // 177 + 360 and 177 - 360 are 177 on the next and previous copy.
    expect(nearestFix(store, kept, 1, [537, 0])).toBe(1);
    expect(nearestFix(store, kept, 1, [-183, 0])).toBe(1);
  });
});
