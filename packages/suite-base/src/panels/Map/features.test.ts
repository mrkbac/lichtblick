// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageEvent } from "@lichtblick/suite";

import {
  DrawnTrack,
  fixPasses,
  groupHitsByTopic,
  headingFromTrack,
  resolveTrackFix,
  trackFeatures,
  trackFixKey,
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
  const base = {
    store,
    version: 0,
    length: 5,
    tailReplacements: 0,
    color: "#ff0000",
    indices: Uint32Array.of(0, 1, 2, 3, 4),
  };

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

describe("trackFeatures colored by value", () => {
  it("draws infinite readings in the topic color, like unknown ones", () => {
    const store = storeOf([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const { points } = trackFeatures([
      {
        store,
        version: store.version,
        length: 3,
        tailReplacements: 0,
        indices: Uint32Array.of(0, 1, 2),
        runs: [0],
        color: "#ff0000",
        style: { history: "points" },
        colorScale: {
          values: Float64Array.of(Infinity, -Infinity, NaN),
          range: [0, 1],
          reverse: false,
          unit: "",
        },
      },
    ]);
    const colors = new Set(points.features.map((f) => f.properties?.c as string));
    expect(colors.size).toBe(1);
  });
});

describe("trackFeatures with a store changed after thinning", () => {
  it("skips the track instead of drawing other fixes", () => {
    const store = storeOf([
      [0, 0],
      [1, 0],
    ]);
    const track: DrawnTrack = {
      store,
      version: store.version,
      length: 2,
      tailReplacements: 0,
      indices: Uint32Array.of(0, 1),
      runs: [0],
      color: "#ff0000",
      style: { history: "both" },
    };
    expect(trackFeatures([track]).points.features).toHaveLength(2);
    store.clear();
    const { points, lines } = trackFeatures([track]);
    expect(points.features).toHaveLength(0);
    expect(lines.features).toHaveLength(0);
  });
});

describe("resolveTrackFix", () => {
  const drawn = (store: TrackStore): DrawnTrack => ({
    store,
    version: store.version,
    length: store.length,
    tailReplacements: store.tailReplacements,
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

  it("lists the runs of fixes the point stands for within the radius", () => {
    const tracks = [drawn(storeOf(points))];
    // Point 2 stands for fixes 1-3; one degree is 1/360 in Web Mercator.
    expect(resolveTrackFix(tracks, 0, 2, [2, 0], 1.5 / 360)?.runs).toEqual([[1, 3]]);
    expect(resolveTrackFix(tracks, 0, 2, [2.6, 0], 0.5 / 360)?.runs).toEqual([[3, 3]]);
    // None that close: the nearest one, as without a radius.
    expect(resolveTrackFix(tracks, 0, 2, [1.6, 0], 0.1 / 360)?.runs).toEqual([[2, 2]]);
    expect(resolveTrackFix(tracks, 0, 2, [1.1, 0])?.runs).toEqual([[1, 1]]);
  });

  it("rejects features that aren't from these tracks", () => {
    const tracks = [drawn(storeOf(points))];
    expect(resolveTrackFix(undefined, 0, 2, [2, 0])).toBeUndefined();
    expect(resolveTrackFix(tracks, 1, 2, [2, 0])).toBeUndefined();
    expect(resolveTrackFix(tracks, "0", 2, [2, 0])).toBeUndefined();
    // Not a drawn index.
    expect(resolveTrackFix(tracks, 0, 3, [3, 0])).toBeUndefined();
  });

  it("rejects rows appended after the overlay was built", () => {
    const store = storeOf(points);
    const tracks = [{ ...drawn(store), length: 3, indices: Uint32Array.of(0, 2) }];
    expect(resolveTrackFix(tracks, 0, 2, [4, 0])?.fix).toBe(2);
    expect(resolveTrackFix([{ ...tracks[0]!, indices: Uint32Array.of(0, 4) }], 0, 4, [4, 0])).toBe(
      undefined,
    );
  });

  it("rejects the newest drawn row once a later fix replaced it", () => {
    // A limit of 4 thins the store: from then on the newest row is replaced until the next kept one.
    const store = new TrackStore("/fix", 4);
    const push = (sec: number) => {
      store.push({
        topic: "/fix",
        schemaName: "sensor_msgs/NavSatFix",
        receiveTime: { sec, nsec: 0 },
        sizeInBytes: 0,
        message: { longitude: sec, latitude: 0 },
      });
    };
    for (let sec = 0; sec < 5; sec++) {
      push(sec);
    }
    const track = { ...drawn(store), indices: Uint32Array.from([...Array(store.length).keys()]) };
    const last = store.length - 1;
    expect(resolveTrackFix([track], 0, last, [99, 0])?.fix).toBe(last);
    push(5);
    push(6);
    expect(store.tailReplacements).toBeGreaterThan(track.tailReplacements);
    expect(resolveTrackFix([track], 0, last, [99, 0])).toBeUndefined();
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

describe("trackFixKey", () => {
  it("changes when the newest row is replaced by a fix with the same time", () => {
    const store = new TrackStore("/fix", 4);
    const push = (longitude: number) => {
      store.push({
        topic: "/fix",
        schemaName: "sensor_msgs/NavSatFix",
        receiveTime: { sec: 1, nsec: 0 },
        sizeInBytes: 0,
        message: { longitude, latitude: 0 },
      });
    };
    const keys: string[] = [];
    for (let i = 0; i < 20; i++) {
      push(i);
      keys.push(trackFixKey(store, store.length - 1));
    }
    // Every push puts another fix in the newest row, so its key is always new.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("changes when the newest row is replaced by a later fix", () => {
    const store = new TrackStore("/fix", 4);
    const push = (sec: number) => {
      store.push({
        topic: "/fix",
        schemaName: "sensor_msgs/NavSatFix",
        receiveTime: { sec, nsec: 0 },
        sizeInBytes: 0,
        message: { longitude: sec, latitude: 0 },
      });
    };
    // Each replacement of the newest row: [row before, row after, key before, key after].
    const replacements: [number, number, string, string][] = [];
    for (let sec = 0; sec < 20; sec++) {
      const last = store.length - 1;
      const before = last >= 0 ? trackFixKey(store, last) : "";
      const count = store.tailReplacements;
      push(sec);
      if (store.tailReplacements > count) {
        replacements.push([last, store.length - 1, before, trackFixKey(store, last)]);
      }
    }
    expect(replacements.length).toBeGreaterThan(0);
    for (const [rowBefore, rowAfter, keyBefore, keyAfter] of replacements) {
      expect(rowAfter).toBe(rowBefore);
      expect(keyAfter).not.toBe(keyBefore);
    }
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

  it("keeps the heading through a long stop", () => {
    const stop: [number, number][] = Array.from({ length: 2000 }, () => [0.001, 0.001]);
    const store = storeOf([[0, 0.001], ...stop]);
    expect(headingFromTrack(store, store.length, [0.001, 0.001])).toBeCloseTo(90);
  });
});

describe("trackFlushDelayMs", () => {
  it("waits longer as the track grows", () => {
    expect(trackFlushDelayMs(0, "recorded")).toBe(50);
    expect(trackFlushDelayMs(0, "live")).toBe(500);
    expect(trackFlushDelayMs(2_000_000, "recorded")).toBe(1000);
  });
});

describe("groupHitsByTopic", () => {
  const hit = (topic: string, sec: number, name?: string) => ({
    message: { topic, receiveTime: { sec, nsec: 0 } } as MessageEvent,
    name,
  });

  it("groups by topic in first-seen order, each by time, without duplicates", () => {
    const groups = groupHitsByTopic([
      hit("/b", 5),
      hit("/a", 3),
      hit("/b", 1),
      // The same fix as a track point and as the current marker.
      hit("/a", 3),
      hit("/a", 2),
      // Two features of one GeoJSON message.
      hit("/zones", 1, "Zone 1"),
      hit("/zones", 1, "Waypoint"),
    ]);
    expect(
      groups.map((group) => group.map((h) => `${h.message.topic}@${h.message.receiveTime.sec}`)),
    ).toEqual([
      ["/b@1", "/b@5"],
      ["/a@2", "/a@3"],
      ["/zones@1", "/zones@1"],
    ]);
  });

  it("is empty with no hits", () => {
    expect(groupHitsByTopic([])).toEqual([]);
  });
});

describe("fixPasses", () => {
  it("merges overlapping and adjacent runs, each shown by its preferred fix or else its first", () => {
    expect(
      fixPasses(
        [
          [20, 21],
          [3, 4],
          [4, 5],
          [9, 9],
          [6, 6],
        ],
        [4, 21],
      ),
    ).toEqual([
      { fix: 4, first: 3, last: 6 },
      { fix: 9, first: 9, last: 9 },
      { fix: 21, first: 20, last: 21 },
    ]);
    expect(fixPasses([], [])).toEqual([]);
  });
});
