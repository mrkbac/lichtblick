// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";

import {
  extendThinnedTrack,
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

describe("extendThinnedTrack", () => {
  it("thins appended fixes like thinning the whole track, also across the viewport edge", () => {
    // A wandering track that leaves and re-enters the viewport, appended a few fixes at a time
    const position = (i: number): [number, number] => [
      Math.sin(i / 17) * 0.02 + i * 0.0001,
      Math.cos(i / 23) * 0.02,
    ];
    const options = {
      zoom: 16,
      minPixels: 2,
      budget: 1e6,
      viewport: { west: -0.01, east: 0.03, south: -0.01, north: 0.01 },
    };
    const store = new TrackStore("/fix");
    let thinned = thinTrack(store, options);
    const mismatches: number[] = [];
    for (let i = 0; i < 600; i++) {
      const [longitude, latitude] = position(i);
      store.push({
        topic: "/fix",
        schemaName: "sensor_msgs/NavSatFix",
        receiveTime: { sec: 1_700_000_000 + i, nsec: 0 },
        sizeInBytes: 0,
        message: { longitude, latitude },
      });
      if (i % 7 === 0 || i === 599) {
        thinned = extendThinnedTrack(store, thinned, options);
        const full = thinTrack(store, options);
        if (!_.isEqual([...thinned.indices, ...thinned.runs], [...full.indices, ...full.runs])) {
          mismatches.push(i);
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(thinned.runs.length).toBeGreaterThan(1);
  });

  it("thins the whole track again once the budget is exceeded", () => {
    const store = storeOf(100, (i) => [i * 0.001, 0]);
    const options = { zoom: 18, minPixels: 1, budget: 100 };
    const first = thinTrack(store, options);
    const more = storeOf(300, (i) => [i * 0.001, 0]);
    const extended = extendThinnedTrack(more, first, options);
    expect(extended.indices.length).toBeLessThanOrEqual(100);
    expect(extended.length).toBe(300);
    expect(extended.indices.at(-1)).toBe(299);
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

  it("keeps a bend into the viewport between two ends outside it", () => {
    // Groups of A(-1,-1) → B(0,0) → C(1,-1): only B is in view; A→C alone would miss the view.
    // Then a detour around it via D and E.
    const points: [number, number][] = [
      [-1, -1],
      [0, 0],
      [1, -1],
      [1, 50],
      [-1, 50],
    ];
    const store = storeOf(150_000, (i) => points[i % 5]!);
    const viewport = { west: -0.1, east: 0.1, south: -0.1, north: 0.1 };
    const { indices, runs } = thinTrack(store, {
      zoom: 18,
      minPixels: 1,
      budget: 50_000,
      viewport,
    });
    expect(indices.length).toBeLessThanOrEqual(50_000);
    expect(runs.length).toBeGreaterThan(10_000);
    runs.forEach((start, r) => {
      const end = runs[r + 1] ?? indices.length;
      expect([...indices.subarray(start, end)].map((i) => store.lngLat(i))).toEqual([
        [-1, -1],
        [0, 0],
        [1, -1],
      ]);
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
    expect(nearestFix(store, kept, 1, [0.0303, 0]).nearest).toBe(30);
    // Not past the kept neighbors.
    expect(nearestFix(store, kept, 0, [0.07, 0]).nearest).toBe(49);
  });

  it("lists the runs within the radius", () => {
    const store = storeOf(100, (i) => [i < 40 ? 0 : i < 60 ? 1 : 0, 0]);
    const kept = Uint32Array.of(0, 50, 99);
    // A visit, a step away, and a second visit.
    expect(nearestFix(store, kept, 1, [0, 0], store.length, 0.5).within).toEqual([
      [1, 39],
      [60, 98],
    ]);
    expect(nearestFix(store, kept, 1, [5, 0], store.length, 0.5).within).toEqual([]);
  });

  it("finds the fix from another copy of the world", () => {
    const store = storeOf(3, (i) => [170 + i * 5, 0]);
    const kept = Uint32Array.of(0, 2);
    // 177 + 360 and 177 - 360 are 177 on the next and previous copy.
    expect(nearestFix(store, kept, 1, [537, 0]).nearest).toBe(1);
    expect(nearestFix(store, kept, 1, [-183, 0]).nearest).toBe(1);
  });
});

describe("ColumnStore.prepend", () => {
  it("keeps one resolution when an earlier window thinned past the limit is put in front", () => {
    for (const playheadRows of [0, 1, 3]) {
      const store = new SampleStore(8);
      for (let t = 0; t < playheadRows; t++) {
        store.push(32 + t, 0);
      }
      const earlier = new SampleStore(8);
      for (let t = 0; t < 32; t++) {
        earlier.push(t, t);
      }
      store.prepend(earlier);
      for (let t = 32 + playheadRows; t < 64; t++) {
        store.push(t, t);
      }
      const times = [...store.columns.time.subarray(0, store.length)];
      // Every gap but the one to the newest row is the same, as when read in time order
      const gaps = new Set(times.slice(1, -1).map((time, i) => time - times[i]!));
      expect(gaps.size).toBeLessThanOrEqual(1);
    }
  });

  it("puts earlier rows in front, thinned to the store's stride", () => {
    const later = new SampleStore(4);
    for (let t = 10; t < 16; t++) {
      later.push(t, t); // past the limit: thinned to every other row
    }
    const earlier = new SampleStore(4);
    for (let t = 0; t < 4; t++) {
      earlier.push(t, t);
    }
    later.prepend(earlier);
    const times = Array.from(later.columns.time.subarray(0, later.length));
    // The limit plus the oldest row at most: the next push halves as usual
    expect(times.length).toBeLessThanOrEqual(5);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBe(15);
  });
  it.each([100, 151])(
    "keeps earlier history at the store's resolution when %i rows already fill it",
    (pushed) => {
      const later = new SampleStore(100);
      for (let t = 1000; t < 1000 + pushed; t++) {
        later.push(t, t);
      }
      const earlier = new SampleStore(100);
      for (let t = 0; t < 50; t++) {
        earlier.push(t, t);
      }
      later.prepend(earlier);
      const times = Array.from(later.columns.time.subarray(0, later.length));
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times.length).toBeLessThanOrEqual(101);
      // Both sides lose resolution evenly: not one row for the whole earlier window
      expect(times.filter((t) => t < 1000).length).toBeGreaterThanOrEqual(12);
      expect(times.at(-1)).toBe(999 + pushed);
    },
  );
});
