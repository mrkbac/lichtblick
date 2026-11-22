// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { headingFromTrack, trackFeatures, trackFlushDelayMs } from "./features";
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
  const base = { store, color: "#ff0000", indices: Uint32Array.of(0, 1, 2, 3, 4) };

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
      { ...base, runs: [0], style: { history: "line" }, scale: Float64Array.of(0, 0, 0, 1, 1) },
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
