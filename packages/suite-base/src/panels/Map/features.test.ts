// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  DrawnTrack,
  headingFromTrack,
  resolveTrackFix,
  trackFeatures,
  trackFlushDelayMs,
} from "./features";
import { TrackStore } from "./track";

function storeOf(points: readonly [number, number][]): TrackStore {
  const store = new TrackStore("/fix");
  points.forEach(([longitude, latitude], sec) => {
    store.push({
      topic: "/fix",
      schemaName: "sensor_msgs/NavSatFix",
      receiveTime: { sec, nsec: 0 },
      sizeInBytes: 0,
      message: { longitude, latitude },
    });
  });
  return store;
}

describe("trackFeatures", () => {
  const store = storeOf([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
  ]);
  const base = { store, version: 0, color: "#ff0000", indices: Uint32Array.of(0, 1, 2, 3, 4) };

  it("draws one line per run and points that index into the store", () => {
    const { points, lines } = trackFeatures([
      { ...base, indices: Uint32Array.of(0, 1, 3, 4), runs: [0, 2], style: { history: "both" } },
    ]);
    expect(points.features.map((f) => f.properties)).toEqual(
      [0, 1, 3, 4].map((i) => expect.objectContaining({ k: 0, i })),
    );
    expect(lines.features.map((f) => f.geometry)).toEqual([
      {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 0],
        ],
      },
      {
        type: "LineString",
        coordinates: [
          [3, 0],
          [4, 0],
        ],
      },
    ]);
  });

  it("merges segments of equal color when colored by value", () => {
    const { lines } = trackFeatures([
      {
        ...base,
        runs: [0],
        style: { history: "line" },
        colorScale: {
          values: Float64Array.of(0, 0, 0, 1, 1),
          range: [0, 1],
          reverse: false,
          unit: "",
        },
      },
    ]);
    expect(lines.features.map((f) => f.geometry)).toEqual([
      {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      },
      {
        type: "LineString",
        coordinates: [
          [2, 0],
          [3, 0],
          [4, 0],
        ],
      },
    ]);
  });
});

describe("resolveTrackFix", () => {
  const drawn = (store: TrackStore): DrawnTrack => ({
    store,
    version: store.version,
    indices: Uint32Array.of(0, 2, 4),
    runs: [0],
    color: "#ff0000",
    style: {},
  });
  const points: [number, number][] = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
  ];

  it("finds the full-resolution fix under the cursor", () => {
    const tracks = [drawn(storeOf(points))];
    expect(resolveTrackFix(tracks, 0, 2, [1.1, 0])?.fix).toBe(1);
    expect(resolveTrackFix(tracks, 0, 4, [4, 0])?.fix).toBe(4);
  });

  it("rejects features that aren't from these tracks", () => {
    const tracks = [drawn(storeOf(points))];
    expect(resolveTrackFix(undefined, 0, 2, [2, 0])).toBeUndefined();
    expect(resolveTrackFix(tracks, 1, 2, [2, 0])).toBeUndefined();
    expect(resolveTrackFix(tracks, "0", 2, [2, 0])).toBeUndefined();
    // Not a drawn index.
    expect(resolveTrackFix(tracks, 0, 3, [3, 0])).toBeUndefined();
  });

  it("rejects features once the store was cleared or thinned since", () => {
    const store = storeOf(points);
    const tracks = [drawn(store)];
    store.clear();
    for (let sec = 0; sec < 5; sec++) {
      store.push({
        topic: "/fix",
        schemaName: "sensor_msgs/NavSatFix",
        receiveTime: { sec, nsec: 0 },
        sizeInBytes: 0,
        message: { longitude: 50, latitude: 50 },
      });
    }
    expect(resolveTrackFix(tracks, 0, 2, [2, 0])).toBeUndefined();
  });
});

describe("headingFromTrack", () => {
  it("uses the latest fix far enough back", () => {
    const store = storeOf([
      [0, 0],
      [0, 0.001],
      [0, 0.001],
    ]);
    expect(headingFromTrack(store, 3, [0, 0.001])).toBeCloseTo(0);
    expect(headingFromTrack(store, 0, [0, 0.001])).toBeUndefined();
  });
});

describe("trackFlushDelayMs", () => {
  it("waits longer as the track grows", () => {
    expect(trackFlushDelayMs(0, "recorded")).toBe(50);
    expect(trackFlushDelayMs(0, "live")).toBe(500);
    expect(trackFlushDelayMs(2_000_000, "recorded")).toBe(1000);
  });
});
